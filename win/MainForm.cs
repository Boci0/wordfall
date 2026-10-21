using System.Drawing;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Wordfall;

/// <summary>
/// The frameless Win95-style shell: a borderless window whose whole client area is a
/// WebView2 showing the game from the in-memory https://wordfall.local origin. The
/// page draws its own title bar and posts "drag" / "min" / "max" / "close" back here.
///
/// Startup is hardened against a locked/corrupt WebView2 profile (0x800700AA "resource
/// in use"): one delayed retry on the configured profile, then a retry with a fresh
/// unique profile before any error is shown to the user.
/// </summary>
internal sealed class MainForm : Form
{
    private const string GameOrigin = "https://wordfall.local";
    private const string GameUrl = GameOrigin + "/index.html";

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;

    private static readonly TimeSpan InitTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(1);
    private static readonly Color WindowBackColor = Color.FromArgb(24, 24, 24);

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    private WebView2 _webView;

    private readonly bool _smoke;
    private readonly string _smokeOutPath;
    private readonly string _browserArguments;
    private readonly string _configuredUserDataFolder;
    private readonly SmokeRunner? _smokeRunner;

    private string _userDataFolderUsed;
    private bool _profileFallbackUsed;
    private bool _started;
    private bool _startupFailureHandled;
    private bool _initializing;
    private Exception? _pendingInitException;
    private bool _lastPostedMaximized;
    private string? _lastNavigationError;

    public MainForm(bool smoke, string smokeOutPath, string browserArguments, bool smokeVisible, string? profileDirOverride)
    {
        _smoke = smoke;
        _smokeOutPath = smokeOutPath;
        _browserArguments = browserArguments ?? string.Empty;

        SuspendLayout();

        Text = "Wordfall";
        Name = "Wordfall";
        FormBorderStyle = FormBorderStyle.None;
        ClientSize = new Size(1200, 760);
        MinimumSize = new Size(640, 400);
        BackColor = WindowBackColor;
        DoubleBuffered = true;

        try
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        }
        catch
        {
            // The exe icon is still used by the taskbar; no need to fail startup.
        }

        if (smoke)
        {
            CleanStaleSmokeFolders();

            // Throwaway profile: back-to-back verification runs must never fight a
            // still-shutting-down WebView2 browser process for the profile lock.
            _configuredUserDataFolder = Path.Combine(Path.GetTempPath(), "Wordfall-smoke-" + Environment.ProcessId);

            if (smokeVisible)
            {
                StartPosition = FormStartPosition.CenterScreen;
                ShowInTaskbar = true;
            }
            else
            {
                // Offscreen instead of Opacity=0: a shown window lets WebView2 initialize
                // without anything flashing on screen.
                StartPosition = FormStartPosition.Manual;
                Location = new Point(-32000, -32000);
                ShowInTaskbar = false;
            }
        }
        else
        {
            StartPosition = FormStartPosition.CenterScreen;
            ShowInTaskbar = true;
            // Keep the user data (and therefore localStorage) outside the dist folder,
            // so the published app also works from a read-only location.
            _configuredUserDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Wordfall",
                "WebView2");
        }

        // Diagnostic override (--profile-dir=...), used to exercise startup recovery.
        if (!string.IsNullOrWhiteSpace(profileDirOverride))
            _configuredUserDataFolder = profileDirOverride;

        _userDataFolderUsed = _configuredUserDataFolder;

        _webView = CreateWebViewControl();
        Controls.Add(_webView);

        if (smoke)
        {
            _smokeRunner = new SmokeRunner(
                () => _webView,
                smokeOutPath,
                _browserArguments,
                () => _lastNavigationError,
                () => _userDataFolderUsed,
                () => _profileFallbackUsed,
                ShutdownAfterSmoke);
            SmokeRunner.Heartbeat(smokeOutPath, "form-created args=[" + _browserArguments + "]");
        }

        Load += OnFormLoaded;
        Activated += OnFormActivated;
        Resize += OnFormResize;
        FormClosing += OnFormClosing;

        ResumeLayout(false);
    }

    private WebView2 CreateWebViewControl()
    {
        var webView = new WebView2
        {
            Dock = DockStyle.Fill,
            DefaultBackgroundColor = WindowBackColor,
        };
        webView.CoreWebView2InitializationCompleted += OnCoreWebView2InitializationCompleted;
        webView.MouseUp += OnWebViewMouseUp;
        return webView;
    }

    private void ReplaceWebViewControl()
    {
        try
        {
            Controls.Remove(_webView);
            _webView.Dispose();
        }
        catch (Exception)
        {
            // Best effort; the new control below is what matters.
        }

        _webView = CreateWebViewControl();
        Controls.Add(_webView);
        _webView.BringToFront();
    }

    private async void OnFormLoaded(object? sender, EventArgs e)
    {
        if (_started) return;
        _started = true;

        SmokeRunner.Heartbeat(_smokeOutPath, "load-fired");

        if (!await InitializeWebView2Async()) return;

        ConfigureCoreWebView2();
        _webView.CoreWebView2.Navigate(GameUrl);
        SmokeRunner.Heartbeat(_smokeOutPath, "navigating");

        if (_smoke) await _smokeRunner!.RunAsync();
    }

    /// <summary>
    /// Creates the WebView2 environment and control. A profile that is locked by a stale
    /// browser process makes CreateAsync fail with 0x800700AA ("the requested resource is
    /// in use"); retry once, then fall back to a brand-new unique profile so the user can
    /// still start. Only after all attempts fail is an error dialog shown.
    /// </summary>
    private async Task<bool> InitializeWebView2Async()
    {
        Exception? lastError = null;
        _initializing = true;

        try
        {
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                string folder = attempt < 3
                    ? _configuredUserDataFolder
                    : CreateFallbackUserDataFolder();

                if (attempt == 2)
                {
                    await Task.Delay(RetryDelay);
                    TryClearStaleProfileLocks(folder);
                }

                if (attempt == 3) _profileFallbackUsed = true;

                _userDataFolderUsed = folder;
                _pendingInitException = null;
                SmokeRunner.Heartbeat(
                    _smokeOutPath,
                    $"webview2-attempt-{attempt} folder={folder}");

                TimeSpan attemptTimeout = attempt == 1 ? InitTimeout : TimeSpan.FromSeconds(20);

                try
                {
                    var options = new CoreWebView2EnvironmentOptions
                    {
                        AdditionalBrowserArguments = _browserArguments,
                    };

                    Task<CoreWebView2Environment> createTask =
                        CoreWebView2Environment.CreateAsync(null, folder, options);
                    if (await Task.WhenAny(createTask, Task.Delay(attemptTimeout)) != createTask)
                        throw new TimeoutException("WebView2 environment creation did not complete in time.");

                    CoreWebView2Environment environment = await createTask;
                    SmokeRunner.Heartbeat(
                        _smokeOutPath,
                        "webview2-environment-ready browser=" + SafeBrowserVersion(environment));

                    Task initTask = _webView.EnsureCoreWebView2Async(environment);
                    if (await Task.WhenAny(initTask, Task.Delay(attemptTimeout)) != initTask)
                        throw new TimeoutException("WebView2 control initialization did not complete in time.");

                    await initTask;
                    SmokeRunner.Heartbeat(
                        _smokeOutPath,
                        $"webview2-control-ready folder={folder} fallback={_profileFallbackUsed}");
                    return true;
                }
                catch (Exception ex)
                {
                    lastError = _pendingInitException ?? ex;
                    _pendingInitException = null;
                    SmokeRunner.Heartbeat(
                        _smokeOutPath,
                        $"webview2-attempt-{attempt}-failed {lastError.GetType().Name}: {lastError.Message}");

                    if (attempt < 3)
                    {
                        // A failed EnsureCoreWebView2Async leaves the control unusable, so
                        // the retry gets a fresh control as well as a fresh environment.
                        ReplaceWebViewControl();
                    }
                }
            }
        }
        finally
        {
            _initializing = false;
        }

        HandleStartupFailure(lastError ?? new InvalidOperationException("WebView2 initialization failed."));
        return false;
    }

    private static string SafeBrowserVersion(CoreWebView2Environment environment)
    {
        try
        {
            return environment.BrowserVersionString;
        }
        catch (Exception)
        {
            return "unknown";
        }
    }

    /// <summary>
    /// A new profile directory for the rare case where the configured profile cannot be
    /// opened. Losing the saved best score is acceptable; refusing to start is not.
    /// </summary>
    private string CreateFallbackUserDataFolder()
    {
        string suffix = DateTime.Now.ToString("yyyyMMdd-HHmmss") + "-" + Random.Shared.Next(1000, 10000);

        if (_smoke)
            return Path.Combine(Path.GetTempPath(), "Wordfall-smoke-" + Environment.ProcessId + "-fallback-" + suffix);

        string root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Wordfall");
        return Path.Combine(root, "WebView2-" + suffix);
    }

    /// <summary>
    /// Chromium's single-instance files can be left behind by a crashed browser process,
    /// which then makes the profile look "in use" forever. Deleting them is safe here:
    /// the app enforces one running Wordfall instance before this code runs, and if a
    /// browser process really is alive the delete fails harmlessly.
    /// </summary>
    private static void TryClearStaleProfileLocks(string folder)
    {
        string[] lockNames = { "SingletonLock", "SingletonCookie", "SingletonSocket", "LOCK", "lockfile" };
        foreach (string directory in new[] { folder, Path.Combine(folder, "EBWebView") })
        {
            if (!Directory.Exists(directory)) continue;

            foreach (string name in lockNames)
            {
                string path = Path.Combine(directory, name);
                try
                {
                    if (File.Exists(path)) File.Delete(path);
                }
                catch (Exception)
                {
                    // In use by a live browser process - leave it alone.
                }
            }
        }
    }

    private void ConfigureCoreWebView2()
    {
        CoreWebView2 core = _webView.CoreWebView2;

        CoreWebView2Settings settings = core.Settings;
        settings.AreDefaultContextMenusEnabled = false;
        settings.AreDevToolsEnabled = false;
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsZoomControlEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsBuiltInErrorPageEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        settings.AreHostObjectsAllowed = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;

        core.AddWebResourceRequestedFilter(GameOrigin + "/*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += OnWebResourceRequested;
        core.WebMessageReceived += OnWebMessageReceived;
        core.NavigationCompleted += OnNavigationCompleted;
        core.NewWindowRequested += OnNewWindowRequested;
        core.ProcessFailed += OnProcessFailed;
    }

    // -- In-memory origin -------------------------------------------------------------

    private void OnWebResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        CoreWebView2 core = _webView.CoreWebView2;
        string name = WebAssets.NormalizeRequestPath(e.Request.Uri);

        if (!WebAssets.TryGet(name, out byte[] bytes, out string contentType))
        {
            e.Response = core.Environment.CreateWebResourceResponse(
                null, 404, "Not Found", "Content-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\n");
            return;
        }

        var stream = new MemoryStream(bytes, writable: false);
        e.Response = core.Environment.CreateWebResourceResponse(
            stream, 200, "OK", $"Content-Type: {contentType}\r\nCache-Control: no-store\r\n");
    }

    private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        if (!e.IsSuccess)
        {
            _lastNavigationError = e.WebErrorStatus.ToString();
            SmokeRunner.Heartbeat(_smokeOutPath, "navigation-failed " + e.WebErrorStatus);
            if (_smoke) return; // the smoke result reports it on timeout
            HandleStartupFailure(new InvalidOperationException(
                $"Navigation to {GameUrl} failed ({e.WebErrorStatus})."));
            return;
        }

        SmokeRunner.Heartbeat(_smokeOutPath, "navigation-completed");

        if (_smoke) return;

        _webView.Focus();
        PostMaximizedState();
    }

    private void OnProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        string message = $"The embedded browser process failed ({e.ProcessFailedKind}).";
        SmokeRunner.Heartbeat(_smokeOutPath, "process-failed " + e.ProcessFailedKind);

        if (_smoke)
        {
            _smokeRunner?.ReportFailure(message);
            return;
        }

        MessageBox.Show(this, message, "Wordfall", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }

    private void OnNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        // The game never needs popups; never let one escape the shell.
        e.Handled = true;
    }

    // -- Title-bar commands from the page ---------------------------------------------

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string message;
        try
        {
            message = e.TryGetWebMessageAsString();
        }
        catch (Exception)
        {
            return; // JSON/object payloads are not title-bar commands
        }

        switch (message.Trim())
        {
            case "drag":
                DragWindow();
                break;
            case "min":
                WindowState = FormWindowState.Minimized;
                break;
            case "max":
                ToggleMaximize();
                break;
            case "close":
                Close();
                break;
        }
    }

    private void DragWindow()
    {
        if (_smoke || WindowState == FormWindowState.Minimized) return;

        ReleaseCapture();
        SendMessage(Handle, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
    }

    private void ToggleMaximize()
    {
        if (WindowState == FormWindowState.Maximized)
        {
            WindowState = FormWindowState.Normal;
        }
        else
        {
            // A borderless window would otherwise maximize over the taskbar.
            MaximizedBounds = Screen.FromHandle(Handle).WorkingArea;
            WindowState = FormWindowState.Maximized;
        }

        PostMaximizedState();
    }

    private void PostMaximizedState()
    {
        CoreWebView2? core = _webView.CoreWebView2;
        if (core is null || _smoke) return;

        bool maximized = WindowState == FormWindowState.Maximized;
        _lastPostedMaximized = maximized;

        // The page listens for a JSON *string* (event.data is a string, not an object).
        string json = JsonSerializer.Serialize(new { type = "maximized", value = maximized });
        try
        {
            core.PostWebMessageAsString(json);
        }
        catch (Exception)
        {
            // Navigation in flight; the NavigationCompleted sync below will resend it.
        }
    }

    // -- Window chrome niceties -------------------------------------------------------

    private void OnFormActivated(object? sender, EventArgs e)
    {
        if (!_smoke) _webView.Focus();
    }

    private void OnWebViewMouseUp(object? sender, MouseEventArgs e)
    {
        if (!_smoke && e.Button == MouseButtons.Left) _webView.Focus();
    }

    private void OnFormResize(object? sender, EventArgs e)
    {
        if (_smoke || _webView.CoreWebView2 is null) return;

        bool maximized = WindowState == FormWindowState.Maximized;
        if (maximized != _lastPostedMaximized) PostMaximizedState();
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
    }

    private void OnCoreWebView2InitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        if (e.IsSuccess) return;

        // During the retry loop this event would otherwise race the retry and abort it
        // before the profile fallback gets a chance to run.
        if (_initializing)
        {
            _pendingInitException = e.InitializationException
                ?? new InvalidOperationException("WebView2 initialization failed.");
            return;
        }

        HandleStartupFailure(e.InitializationException
            ?? new InvalidOperationException("WebView2 initialization failed."));
    }

    private void HandleStartupFailure(Exception ex)
    {
        if (_startupFailureHandled) return;
        _startupFailureHandled = true;

        SmokeRunner.Heartbeat(_smokeOutPath, "startup-failure " + ex.GetType().Name + ": " + ex.Message);

        if (_smoke)
        {
            _smokeRunner?.ReportFailure(DescribeFailure(ex));
            return;
        }

        MessageBox.Show(
            this,
            "Wordfall could not start its embedded browser (WebView2).\r\n\r\n" +
            DescribeFailure(ex) +
            "\r\n\r\nInstall the Microsoft Edge WebView2 Runtime and try again.",
            "Wordfall",
            MessageBoxButtons.OK,
            MessageBoxIcon.Error);
        Close();
    }

    private static string DescribeFailure(Exception ex)
    {
        // 0x800700AA: the WebView2 user data folder is already in use by another process.
        if (ex is COMException com && com.HResult == unchecked((int)0x800700AA))
        {
            return ex.Message +
                   "\r\n\r\nWebView2 could not open its data folder even after retrying with a clean one. " +
                   "Close all Wordfall windows and try again.";
        }

        return ex.GetType().Name + ": " + ex.Message;
    }

    /// <summary>Called by the smoke runner after the result is written, before exiting.</summary>
    private void ShutdownAfterSmoke()
    {
        SmokeRunner.Heartbeat(_smokeOutPath, "shutdown");

        try
        {
            _webView.Dispose();
        }
        catch (Exception)
        {
            // Best effort.
        }

        try
        {
            if (Directory.Exists(_userDataFolderUsed))
                Directory.Delete(_userDataFolderUsed, recursive: true);
        }
        catch (Exception)
        {
            // The browser process may still hold a file; the OS can clean it later.
        }
    }

    private static void CleanStaleSmokeFolders()
    {
        try
        {
            foreach (string directory in Directory.GetDirectories(Path.GetTempPath(), "Wordfall-smoke-*"))
            {
                try
                {
                    if (DateTime.UtcNow - Directory.GetLastWriteTimeUtc(directory) > TimeSpan.FromHours(2))
                        Directory.Delete(directory, recursive: true);
                }
                catch (Exception)
                {
                    // In use by a concurrent smoke run; leave it alone.
                }
            }
        }
        catch (Exception)
        {
            // Temp folder unreadable: nothing critical.
        }
    }
}
