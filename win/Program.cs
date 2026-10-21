using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace Wordfall;

internal static class Program
{
    private const int AttachParentProcess = -1;
    private const int SW_RESTORE = 9;

    private static Mutex? _singleInstanceMutex;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(int dwProcessId);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [STAThread]
    private static void Main(string[] args)
    {
        bool smoke = HasFlag(args, "--smoke");
        bool smokeVisible = HasFlag(args, "--smoke-visible");
        bool selfTest = HasFlag(args, "--selftest") || HasFlag(args, "--version");
        bool updateCheck = HasFlag(args, "--check-update");
        string? updateSelfTestDir = ValueOf(args, "--update-selftest=");

        string? smokeOut = ValueOf(args, "--smoke-out=");
        string? selfTestOut = ValueOf(args, "--selftest-out=");
        string browserArguments = ValueOf(args, "--browser-args=")
            ?? Environment.GetEnvironmentVariable("WORDFALL_BROWSER_ARGS")
            ?? string.Empty;

        smokeOut ??= Path.Combine(AppContext.BaseDirectory, "smoke-result.json");

        if (smoke || selfTest || updateCheck || updateSelfTestDir is not null) AttachConsoleIfPossible();

        if (selfTest) Environment.Exit(RunSelfTest(selfTestOut));
        if (updateCheck) Environment.Exit(RunUpdateCheck(args));
        if (updateSelfTestDir is not null) Environment.Exit(RunUpdateSelfTest(args, updateSelfTestDir));
        string? updaterScriptOut = ValueOf(args, "--write-updater-script=");
        if (updaterScriptOut is not null)
        {
            File.WriteAllText(updaterScriptOut, Updater.InstallerScriptText);
            Console.WriteLine("wordfall: updater install script written to " + Path.GetFullPath(updaterScriptOut));
            Environment.Exit(0);
        }
        if (HasFlag(args, "--instance-check")) Environment.Exit(RunInstanceCheck(args));

        if (smoke)
        {
            // This watchdog lives on its own thread, so a blocked UI thread or a hung
            // WebView2 initialization can never leave the smoke run hanging forever.
            SmokeRunner.StartIndependentWatchdog(smokeOut, browserArguments);
        }
        else if (!AcquireSingleInstance())
        {
            // Another Wordfall window is already open: bring it forward instead of
            // creating a second WebView2 environment on the same profile (the classic
            // 0x800700AA "requested resource is in use" startup failure).
            return;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        try
        {
            Application.Run(new MainForm(
                smoke,
                smokeOut,
                browserArguments,
                smokeVisible,
                ValueOf(args, "--profile-dir=")));
        }
        catch (Exception ex)
        {
            if (smoke)
            {
                SmokeRunner.ReportFatal(smokeOut, ex);
            }
            else
            {
                MessageBox.Show(
                    "Wordfall could not start.\r\n\r\n" + ex.Message,
                    "Wordfall",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                Environment.Exit(1);
            }
        }
    }

    /// <summary>
    /// A WinExe has no console of its own. When started from a console, attach to the
    /// parent console so --smoke / --selftest output is visible.
    /// </summary>
    internal static void AttachConsoleIfPossible()
    {
        try
        {
            if (AttachConsole(AttachParentProcess))
            {
                Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true });
                Console.SetError(new StreamWriter(Console.OpenStandardError()) { AutoFlush = true });
            }
        }
        catch
        {
            // Launched by double-click: there is no parent console. Result files still work.
        }
    }

    private static bool HasFlag(string[] args, string flag) =>
        args.Any(arg => string.Equals(arg, flag, StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Internal diagnostic (--instance-check): exercises the exact single-instance logic
    /// used by normal launches without creating a window or WebView2. The first invocation
    /// prints role=primary; a concurrent invocation prints role=secondary and exits 0
    /// silently (no error dialog), proving the second-launch path.
    /// </summary>
    private static int RunInstanceCheck(string[] args)
    {
        int holdMs = 0;
        string? hold = ValueOf(args, "--hold=");
        if (hold is not null) int.TryParse(hold, out holdMs);

        bool primary = AcquireSingleInstance();
        Console.WriteLine(JsonSerializer.Serialize(new
        {
            mode = "instance-check",
            role = primary ? "primary" : "secondary",
            activatedExistingWindow = !primary,
            pid = Environment.ProcessId,
        }));

        if (primary && holdMs > 0) Thread.Sleep(holdMs);
        return 0;
    }

    private static string? ValueOf(string[] args, string prefix)
    {
        foreach (string arg in args)
        {
            if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return arg[prefix.Length..].Trim('"');
        }
        return null;
    }

    /// <summary>
    /// Diagnostics that never touches WebView2: verifies the WinForms build starts and
    /// the four web assets are embedded, then writes a JSON result and exits 0/1.
    /// </summary>
    private static int RunSelfTest(string? outPath)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Assembly assembly = Assembly.GetExecutingAssembly();
        string[] expected =
        {
            "Wordfall.web.index.html",
            "Wordfall.web.style.css",
            "Wordfall.web.words.js",
            "Wordfall.web.game.js",
        };

        var resources = new List<Dictionary<string, object?>>();
        bool resourcesOk = true;
        foreach (string name in expected)
        {
            using Stream? stream = assembly.GetManifestResourceStream(name);
            var entry = new Dictionary<string, object?>
            {
                ["name"] = name,
                ["exists"] = stream is not null,
                ["bytes"] = stream?.Length ?? 0,
            };
            resources.Add(entry);
            if (stream is null) resourcesOk = false;
        }

        string? webView2Version = null;
        string? webView2Error = null;
        try
        {
            webView2Version = CoreWebView2Environment.GetAvailableBrowserVersionString();
        }
        catch (Exception ex)
        {
            webView2Error = ex.GetType().Name + ": " + ex.Message;
        }

        bool assetsMapOk = true;
        string? assetsMapError = null;
        try
        {
            foreach (string file in new[] { "index.html", "style.css", "words.js", "game.js" })
            {
                if (!WebAssets.TryGet(file, out byte[] bytes, out string contentType))
                    throw new InvalidOperationException($"WebAssets has no entry for {file}");
                if (bytes.Length == 0 || string.IsNullOrEmpty(contentType))
                    throw new InvalidOperationException($"WebAssets entry for {file} is empty");
            }
        }
        catch (Exception ex)
        {
            assetsMapOk = false;
            assetsMapError = ex.GetType().Name + ": " + ex.Message;
        }

        bool ok = resourcesOk && assetsMapOk;
        var payload = new Dictionary<string, object?>
        {
            ["ok"] = ok,
            ["mode"] = "selftest",
            ["appVersion"] = AppVersion.Current,
            ["exe"] = Application.ExecutablePath,
            ["baseDir"] = AppContext.BaseDirectory,
            ["dotnetVersion"] = Environment.Version.ToString(),
            ["os"] = Environment.OSVersion.VersionString,
            ["resources"] = resources,
            ["webAssetsOk"] = assetsMapOk,
            ["webAssetsError"] = assetsMapError,
            ["webview2Runtime"] = webView2Version,
            ["webview2RuntimeError"] = webView2Error,
            ["timestamp"] = DateTimeOffset.Now.ToString("O"),
        };

        string json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
        Console.WriteLine("Wordfall selftest");
        Console.WriteLine(json);
        WriteResult(outPath ?? Path.Combine(AppContext.BaseDirectory, "selftest-result.json"), json);
        return ok ? 0 : 1;
    }

    /// <summary>
    /// Diagnostic (--check-update): queries the GitHub release feed and prints the result as
    /// JSON. Exits 0 when the check itself succeeded (update available or not), 1 on error.
    /// Optional: --current-version=X overrides the installed version for deterministic tests,
    /// --update-out=path writes the JSON next to a log.
    /// </summary>
    private static int RunUpdateCheck(string[] args)
    {
        string? currentOverride = ValueOf(args, "--current-version=");
        UpdateCheckResult result = Updater.CheckAsync(currentOverride).GetAwaiter().GetResult();
        string json = result.ToJson();
        Console.WriteLine("Wordfall update check");
        Console.WriteLine(json);

        string? outPath = ValueOf(args, "--update-out=");
        if (!string.IsNullOrWhiteSpace(outPath)) WriteResult(outPath!, json);
        return result.Ok ? 0 : 1;
    }

    /// <summary>
    /// Diagnostic (--update-selftest=DIR): performs the full updater download path — check,
    /// download the latest release zip, verify its SHA-256, extract and validate Wordfall.exe —
    /// then cleans the staging folder (unless --keep-staged) and reports JSON. This never
    /// replaces the running install; the app's end-to-end install path is exercised by
    /// UpdateProgressForm + Updater.LaunchInstallerAndExit.
    /// </summary>
    private static int RunUpdateSelfTest(string[] args, string directory)
    {
        string? currentOverride = ValueOf(args, "--current-version=");
        bool keepStaged = HasFlag(args, "--keep-staged");
        UpdateCheckResult check = Updater.CheckAsync(currentOverride).GetAwaiter().GetResult();

        string? staged = null;
        string? error = check.Ok ? null : check.Error;
        int files = 0;
        bool exeExists = false;
        bool ok = false;
        string? cleanupError = null;

        try
        {
            if (!check.Ok) throw new InvalidOperationException(check.Error ?? "update check failed.");
            if (!check.Available)
                throw new InvalidOperationException(
                    $"no update available: current {check.Current}, latest {check.Latest ?? "unknown"}.");
            Directory.CreateDirectory(directory);
            staged = Updater.DownloadAndStageAsync(check).GetAwaiter().GetResult();
            exeExists = File.Exists(Path.Combine(staged, "Wordfall.exe"));
            files = Directory.GetFiles(staged, "*", SearchOption.AllDirectories).Length;
            ok = exeExists && files > 0;
            if (!ok) error = "staged update did not contain Wordfall.exe.";
        }
        catch (Exception ex)
        {
            error = ex.GetType().Name + ": " + ex.Message;
        }
        finally
        {
            if (staged is not null && !keepStaged)
            {
                try
                {
                    string? root = Directory.GetParent(staged)?.FullName;
                    if (root is not null && Directory.Exists(root)) Directory.Delete(root, recursive: true);
                }
                catch (Exception ex)
                {
                    cleanupError = ex.GetType().Name + ": " + ex.Message;
                }
            }
        }

        var payload = new Dictionary<string, object?>
        {
            ["ok"] = ok,
            ["mode"] = "update-selftest",
            ["appVersion"] = AppVersion.Current,
            ["current"] = check.Current,
            ["latest"] = check.Latest,
            ["available"] = check.Available,
            ["tag"] = check.Tag,
            ["assetName"] = check.AssetName,
            ["assetSize"] = check.AssetSize,
            ["assetSha256Present"] = !string.IsNullOrWhiteSpace(check.AssetSha256),
            ["staged"] = keepStaged ? staged : null,
            ["stagedExe"] = exeExists,
            ["stagedFiles"] = files,
            ["cleanupError"] = cleanupError,
            ["error"] = error,
            ["timestamp"] = DateTimeOffset.Now.ToString("O"),
        };

        string json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
        Console.WriteLine("Wordfall update selftest");
        Console.WriteLine(json);

        string? outPath = ValueOf(args, "--update-out=");
        WriteResult(outPath ?? Path.Combine(AppContext.BaseDirectory, "update-selftest-result.json"), json);
        return ok ? 0 : 1;
    }

    private static void WriteResult(string path, string json)
    {
        foreach (string candidate in new[] { path, Path.Combine(Path.GetTempPath(), Path.GetFileName(path)) })
        {
            try
            {
                string? directory = Path.GetDirectoryName(Path.GetFullPath(candidate));
                if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
                File.WriteAllText(candidate, json);
                return;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"wordfall: could not write {candidate}: {ex.GetType().Name}: {ex.Message}");
            }
        }
    }

    private static bool AcquireSingleInstance()
    {
        try
        {
            _singleInstanceMutex = new Mutex(initiallyOwned: true, @"Local\Wordfall.Desktop.SingleInstance", out bool createdNew);
            if (createdNew) return true;

            ActivateExistingWindow();
            return false;
        }
        catch (Exception)
        {
            return true;
        }
    }

    private static void ActivateExistingWindow()
    {
        try
        {
            foreach (Process process in Process.GetProcessesByName("Wordfall"))
            {
                if (process.Id == Environment.ProcessId) continue;

                IntPtr handle = process.MainWindowHandle;
                if (handle == IntPtr.Zero) continue;

                ShowWindow(handle, SW_RESTORE);
                SetForegroundWindow(handle);
                return;
            }
        }
        catch (Exception)
        {
            // Best effort; the new instance closing is still the right outcome.
        }
    }
}
