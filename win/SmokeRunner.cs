using System.Diagnostics;
using System.Text.Json;
using Microsoft.Web.WebView2.WinForms;

namespace Wordfall;

/// <summary>
/// Automated verification mode (--smoke). The window is created offscreen, the page is
/// loaded, window.__wordfall.version must reach M5, the Win95 UI must have switched to
/// embedded mode, and then a seeded scripted run is executed. The JSON result is written
/// next to the exe (or --smoke-out=path) and the process exits 0 (pass) / 1 (fail).
///
/// A heartbeat log and a watchdog thread on an independent thread make a hung UI thread
/// or a stuck WebView2 startup observable instead of leaving the process hanging forever.
/// </summary>
internal sealed class SmokeRunner
{
    private static readonly TimeSpan ReadyTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan EmbeddedTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan WatchdogTimeout = TimeSpan.FromSeconds(90);

    private static readonly object Gate = new();
    private static bool _completed;
    private static bool _heartbeatEnabled;
    private static string _watchdogBrowserArguments = string.Empty;

    private readonly Func<WebView2> _webViewProvider;
    private readonly string _outPath;
    private readonly string _browserArguments;
    private readonly Func<string?> _lastNavigationError;
    private readonly Func<string?> _userDataFolder;
    private readonly Func<bool> _profileFallbackUsed;
    private readonly Action _shutdown;

    private WebView2 WebView => _webViewProvider();

    public SmokeRunner(
        Func<WebView2> webViewProvider,
        string outPath,
        string browserArguments,
        Func<string?> lastNavigationError,
        Func<string?> userDataFolder,
        Func<bool> profileFallbackUsed,
        Action shutdown)
    {
        _webViewProvider = webViewProvider;
        _outPath = outPath;
        _browserArguments = browserArguments ?? string.Empty;
        _lastNavigationError = lastNavigationError;
        _userDataFolder = userDataFolder;
        _profileFallbackUsed = profileFallbackUsed;
        _shutdown = shutdown;
    }

    public async Task RunAsync()
    {
        Heartbeat(_outPath, "smoke-run-start");

        var stopwatch = Stopwatch.StartNew();
        string? version = null;
        string? phase = null;
        string? titleText = null;
        bool? embeddedMode = null;
        bool? hasWebViewBridge = null;
        JsonElement? simResult = null;
        string? error = null;
        bool ok = false;

        try
        {
            while (stopwatch.Elapsed < ReadyTimeout)
            {
                version = await EvalStringAsync("(window.__wordfall && window.__wordfall.version) || null");
                if (version == "M5") break;
                await Task.Delay(200);
            }

            if (version != "M5")
            {
                string navigation = _lastNavigationError() is { } status
                    ? $" (last navigation error: {status})"
                    : string.Empty;
                throw new TimeoutException(
                    $"window.__wordfall.version never reached 'M5' within {ReadyTimeout.TotalSeconds:0}s " +
                    $"(last value: {version ?? "null"}){navigation}");
            }

            Heartbeat(_outPath, "game-ready version=M5");
            hasWebViewBridge = await EvalBoolAsync("!!(window.chrome && window.chrome.webview)");

            // body.embedded is added once the page notices it runs inside WebView2; it may
            // land slightly after the game script, so poll briefly instead of racing it.
            var embeddedWait = Stopwatch.StartNew();
            while (embeddedWait.Elapsed < EmbeddedTimeout)
            {
                embeddedMode = await EvalBoolAsync("document.body.classList.contains('embedded')");
                if (embeddedMode == true) break;
                await Task.Delay(100);
            }
            if (embeddedMode != true)
                throw new InvalidOperationException(
                    "the page did not switch to embedded mode (document.body has no 'embedded' class)");
            Heartbeat(_outPath, "embedded-mode-ok");

            titleText = await EvalStringAsync(
                "var el = document.getElementById('titleText'); el ? el.textContent : null");
            if (string.IsNullOrWhiteSpace(titleText) ||
                !titleText.TrimStart().StartsWith("Wordfall", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"titleText check failed (expected text starting with 'Wordfall', got: {titleText ?? "null"})");
            }
            Heartbeat(_outPath, "title-text-ok");

            string? simJson = await EvalStringAsync(
                "JSON.stringify(window.__wordfall.sim({wpm:60, mode:'skip', seed:1000}))");
            if (string.IsNullOrWhiteSpace(simJson))
                throw new InvalidOperationException("window.__wordfall.sim() returned no JSON.");

            using (JsonDocument document = JsonDocument.Parse(simJson))
            {
                simResult = document.RootElement.Clone();
            }
            Heartbeat(_outPath, "sim-done");

            phase = await EvalStringAsync(
                "(window.__wordfall && window.__wordfall.state && window.__wordfall.state.phase) || null");
            if (phase is null)
                throw new InvalidOperationException("window.__wordfall.state.phase is unavailable.");

            ok = true;
        }
        catch (Exception ex)
        {
            error = ex.GetType().Name + ": " + ex.Message;
        }

        Finish(ok, version, phase, titleText, embeddedMode, hasWebViewBridge,
            simResult, stopwatch.ElapsedMilliseconds, BrowserVersion(), error);
    }

    public void ReportFailure(string error) =>
        Finish(false, null, null, null, null, null, null, 0, BrowserVersion(), error);

    public static void ReportFatal(string outPath, Exception ex)
    {
        if (IsCompleted) return;
        MarkCompleted();
        string json = Serialize(CreatePayload(
            _watchdogBrowserArguments, false, null, null, null, null, null, null, 0, null,
            null, null, ex.GetType().Name + ": " + ex.Message, outPath));
        Write(outPath, json);
        Print(json);
        Environment.Exit(1);
    }

    /// <summary>
    /// Starts a watchdog on a plain background thread. Unlike a WinForms timer it does
    /// not need the UI message loop, so it can report and exit even if startup hangs.
    /// </summary>
    public static void StartIndependentWatchdog(string outPath, string browserArguments)
    {
        _watchdogBrowserArguments = browserArguments ?? string.Empty;
        _heartbeatEnabled = true;
        Heartbeat(outPath, "process-start args=[" + _watchdogBrowserArguments + "]");

        var thread = new Thread(() =>
        {
            try
            {
                Thread.Sleep(WatchdogTimeout);
                if (IsCompleted) return;

                MarkCompleted();
                string json = Serialize(CreatePayload(
                    _watchdogBrowserArguments, false, null, null, null, null, null, null, -1, null,
                    null, null,
                    $"smoke watchdog: no result after {WatchdogTimeout.TotalSeconds:0}s - " +
                    "the UI thread was blocked or WebView2 never finished initializing",
                    outPath));
                Write(outPath, json);
                Print(json);
            }
            catch (Exception)
            {
                // Nothing left to do; exit below regardless.
            }

            Environment.Exit(1);
        })
        {
            IsBackground = true,
            Name = "wordfall-smoke-watchdog",
        };
        thread.Start();
    }

    public static bool IsCompleted
    {
        get
        {
            lock (Gate)
            {
                return _completed;
            }
        }
    }

    private static void MarkCompleted()
    {
        lock (Gate)
        {
            _completed = true;
        }
    }

    private void Finish(
        bool ok,
        string? version,
        string? phase,
        string? titleText,
        bool? embeddedMode,
        bool? hasWebViewBridge,
        JsonElement? simResult,
        long elapsedMs,
        string? browserVersion,
        string? error)
    {
        MarkCompleted();

        string json = Serialize(CreatePayload(
            _browserArguments, ok, version, phase, titleText, embeddedMode, hasWebViewBridge,
            simResult, elapsedMs, browserVersion,
            _userDataFolder(), _profileFallbackUsed(), error, _outPath));

        Write(_outPath, json);
        Print(json);

        Heartbeat(_outPath, ok ? "finished PASS" : "finished FAIL");

        // Let WebView2 shut down cleanly (and release the temporary user data folder)
        // before terminating; the result file has already been written.
        try
        {
            _shutdown();
        }
        catch (Exception)
        {
            // Best effort only.
        }

        Environment.Exit(ok ? 0 : 1);
    }

    private static Dictionary<string, object?> CreatePayload(
        string browserArguments,
        bool ok,
        string? version,
        string? phase,
        string? titleText,
        bool? embeddedMode,
        bool? hasWebViewBridge,
        JsonElement? simResult,
        long elapsedMs,
        string? browserVersion,
        string? userDataFolder,
        bool? profileFallback,
        string? error,
        string outPath)
    {
        return new Dictionary<string, object?>
        {
            ["ok"] = ok,
            ["mode"] = "smoke",
            ["version"] = version,
            ["phase"] = phase,
            ["embeddedMode"] = embeddedMode,
            ["hasWebViewBridge"] = hasWebViewBridge,
            ["titleText"] = titleText,
            ["simResult"] = simResult,
            ["elapsedMs"] = elapsedMs,
            ["browserVersion"] = browserVersion,
            ["browserArguments"] = browserArguments,
            ["userDataFolder"] = userDataFolder,
            ["profileFallback"] = profileFallback,
            ["exe"] = Application.ExecutablePath,
            ["resultFile"] = outPath,
            ["timestamp"] = DateTimeOffset.Now.ToString("O"),
            ["error"] = error,
        };
    }

    private async Task<string?> EvalStringAsync(string expression)
    {
        string raw = await WebView.CoreWebView2.ExecuteScriptAsync(expression);
        if (string.IsNullOrEmpty(raw) || raw == "null") return null;
        return JsonSerializer.Deserialize<string>(raw);
    }

    private async Task<bool> EvalBoolAsync(string expression)
    {
        string raw = await WebView.CoreWebView2.ExecuteScriptAsync(expression);
        return string.Equals(raw, "true", StringComparison.OrdinalIgnoreCase);
    }

    private string? BrowserVersion()
    {
        try
        {
            return WebView.CoreWebView2?.Environment.BrowserVersionString;
        }
        catch (Exception)
        {
            return null;
        }
    }

    internal static void Heartbeat(string outPath, string stage)
    {
        if (!_heartbeatEnabled) return;

        try
        {
            string? directory = Path.GetDirectoryName(Path.GetFullPath(outPath));
            if (string.IsNullOrEmpty(directory)) return;
            Directory.CreateDirectory(directory);
            string path = Path.Combine(directory, "smoke-heartbeat.log");
            File.AppendAllText(path, DateTimeOffset.Now.ToString("HH:mm:ss.fff") + "  " + stage + Environment.NewLine);
        }
        catch (Exception)
        {
            // Heartbeat is diagnostic only; never let it break the run.
        }
    }

    private static string Serialize(Dictionary<string, object?> payload) =>
        JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });

    private static void Write(string path, string json)
    {
        try
        {
            string? directory = Path.GetDirectoryName(Path.GetFullPath(path));
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            File.WriteAllText(path, json);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"wordfall smoke: could not write {path}: {ex.GetType().FullName}: {ex.Message}");
            Console.Error.WriteLine(ex.ToString());
        }
    }

    private static void Print(string json)
    {
        Program.AttachConsoleIfPossible();
        try
        {
            Console.WriteLine("Wordfall smoke");
            Console.WriteLine(json);
        }
        catch (Exception)
        {
            // No console attached; the result file is the source of truth.
        }
    }
}
