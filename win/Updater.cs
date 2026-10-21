using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Wordfall;

/// <summary>
/// In-app updater. Checks the public GitHub release feed, downloads the Windows build,
/// verifies GitHub's SHA-256 digest, stages it, and then hands the file swap to a tiny
/// PowerShell helper that waits for this process to exit, replaces the app files and
/// relaunches Wordfall. Everything is best-effort and offline-safe: a failed check just
/// means the installed build keeps running.
/// </summary>
internal static class Updater
{
    public const string ReleasesPage = "https://github.com/Boci0/wordfall/releases/latest";
    private const string LatestReleaseApi = "https://api.github.com/repos/Boci0/wordfall/releases/latest";
    private const string UpdateDirName = "updates";

    private static readonly HttpClient Http = CreateHttpClient();

    public static string CurrentVersion => AppVersion.Current;

    private static HttpClient CreateHttpClient()
    {
        var client = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(45),
        };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("Wordfall-Updater/1.0 (+https://github.com/Boci0/wordfall)");
        client.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
        return client;
    }

    public static string UpdateRoot =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Wordfall", UpdateDirName);

    /// <summary>Where the running exe lives. Installing into %LOCALAPPDATA% keeps this writable.</summary>
    public static string InstallDirectory => AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);

    /// <summary>Diagnostics hook (--write-updater-script=…): the detached install helper text.</summary>
    internal static string InstallerScriptText => InstallerScript;

    /// <summary>
    /// A self-update needs to replace files next to the running exe. If that folder is not
    /// writable (e.g. copied into Program Files), we fall back to opening the release page.
    /// </summary>
    public static bool CanSelfUpdate(out string? reason)
    {
        reason = null;
        try
        {
            string probe = Path.Combine(InstallDirectory, ".update-probe-" + Environment.ProcessId);
            File.WriteAllText(probe, "probe");
            File.Delete(probe);
            return true;
        }
        catch (Exception ex)
        {
            reason = ex.GetType().Name + ": " + ex.Message;
            return false;
        }
    }

    public static async Task<UpdateCheckResult> CheckAsync(string? currentOverride = null, CancellationToken ct = default)
    {
        string current = string.IsNullOrWhiteSpace(currentOverride) ? CurrentVersion : currentOverride!.Trim();
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, LatestReleaseApi);
            using HttpResponseMessage response = await Http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
            response.EnsureSuccessStatusCode();
            await using Stream stream = await response.Content.ReadAsStreamAsync(ct);
            using JsonDocument document = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            JsonElement root = document.RootElement;

            string tag = GetString(root, "tag_name") ?? string.Empty;
            string latest = NormalizeVersionText(tag);
            string title = GetString(root, "name") ?? tag;
            string releaseUrl = GetString(root, "html_url") ?? ReleasesPage;
            string? notes = GetString(root, "body");

            UpdateAsset? asset = PickAsset(root);
            bool available = asset is not null && AppVersion.IsNewer(latest, current);

            return new UpdateCheckResult
            {
                Ok = true,
                Current = current,
                Latest = latest,
                Tag = tag,
                Title = title,
                ReleaseUrl = releaseUrl,
                Notes = TrimNotes(notes),
                Available = available,
                AssetName = asset?.Name,
                AssetUrl = asset?.DownloadUrl,
                AssetSize = asset?.Size ?? 0,
                AssetSha256 = asset?.Sha256,
            };
        }
        catch (Exception ex)
        {
            return new UpdateCheckResult
            {
                Ok = false,
                Current = current,
                Error = ex.GetType().Name + ": " + ex.Message,
            };
        }
    }

    /// <summary>Downloads the release zip, verifies its SHA-256, extracts it and returns the staged folder.</summary>
    public static async Task<string> DownloadAndStageAsync(
        UpdateCheckResult info,
        IProgress<int>? progress = null,
        CancellationToken ct = default)
    {
        if (!info.Ok || !info.Available) throw new InvalidOperationException("No update is available to download.");
        if (string.IsNullOrWhiteSpace(info.AssetUrl)) throw new InvalidOperationException("The release has no Windows zip asset.");

        string root = Path.Combine(UpdateRoot, SafeName(info.Tag ?? info.Latest ?? "update"));
        try
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
        catch (Exception)
        {
            // A previous update folder may be locked; a fresh name below keeps going.
            root = Path.Combine(UpdateRoot, SafeName(info.Tag ?? "update") + "-" + Environment.ProcessId);
        }
        Directory.CreateDirectory(root);

        string zipPath = Path.Combine(root, "Wordfall-win64.zip");
        using (HttpResponseMessage response = await Http.GetAsync(info.AssetUrl, HttpCompletionOption.ResponseHeadersRead, ct))
        {
            response.EnsureSuccessStatusCode();
            long total = response.Content.Headers.ContentLength ?? info.AssetSize;
            await using Stream input = await response.Content.ReadAsStreamAsync(ct);
            await using FileStream output = File.Create(zipPath);
            byte[] buffer = new byte[81920];
            long received = 0;
            int read;
            while ((read = await input.ReadAsync(buffer, ct)) > 0)
            {
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
                received += read;
                if (total > 0) progress?.Report((int)Math.Clamp(received * 100 / total, 0, 100));
            }
        }

        if (!string.IsNullOrWhiteSpace(info.AssetSha256))
        {
            string actual = Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(zipPath, ct)));
            if (!string.Equals(actual, info.AssetSha256, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    "The downloaded update failed its SHA-256 integrity check, so it was discarded.");
        }

        string staged = Path.Combine(root, "staged");
        ZipFile.ExtractToDirectory(zipPath, staged);

        // Accept both flat zips (our release layout) and a single top-level folder.
        if (!File.Exists(Path.Combine(staged, "Wordfall.exe")))
        {
            string[] candidates = Directory.GetDirectories(staged);
            foreach (string candidate in candidates)
            {
                if (File.Exists(Path.Combine(candidate, "Wordfall.exe")))
                {
                    staged = candidate;
                    break;
                }
            }
        }

        if (!File.Exists(Path.Combine(staged, "Wordfall.exe")))
            throw new InvalidOperationException("The downloaded update does not contain Wordfall.exe.");

        progress?.Report(100);
        return staged;
    }

    /// <summary>
    /// Starts the detached PowerShell helper that waits for this process to exit, copies the
    /// staged files over the install folder and relaunches Wordfall. Returns the script path
    /// (also used by --update-selftest / diagnostics).
    /// </summary>
    public static string LaunchInstallerAndExit(string stagedDirectory, bool noStart = false)
    {
        string scriptPath = Path.Combine(Path.GetTempPath(), "Wordfall-update-" + Environment.ProcessId + ".ps1");
        string logPath = Path.Combine(UpdateRoot, "last-update.log");
        Directory.CreateDirectory(UpdateRoot);
        File.WriteAllText(scriptPath, InstallerScript, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        var startInfo = new ProcessStartInfo("powershell.exe")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-WindowStyle");
        startInfo.ArgumentList.Add("Hidden");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);
        startInfo.ArgumentList.Add("-ParentPid");
        startInfo.ArgumentList.Add(Environment.ProcessId.ToString());
        startInfo.ArgumentList.Add("-Staged");
        startInfo.ArgumentList.Add(stagedDirectory);
        startInfo.ArgumentList.Add("-Target");
        startInfo.ArgumentList.Add(InstallDirectory);
        startInfo.ArgumentList.Add("-Log");
        startInfo.ArgumentList.Add(logPath);
        if (noStart) startInfo.ArgumentList.Add("-NoStart");

        Process.Start(startInfo);
        return scriptPath;
    }

    public static void OpenReleasePage(string? url = null)
    {
        string target = string.IsNullOrWhiteSpace(url) ? ReleasesPage : url!;
        try
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception)
        {
            // No default browser: the user still has the release URL in the dialog text.
        }
    }

    // -- GitHub JSON helpers ---------------------------------------------------------

    private static UpdateAsset? PickAsset(JsonElement release)
    {
        if (!release.TryGetProperty("assets", out JsonElement assets) || assets.ValueKind != JsonValueKind.Array)
            return null;

        UpdateAsset? best = null;
        foreach (JsonElement asset in assets.EnumerateArray())
        {
            string name = GetString(asset, "name") ?? string.Empty;
            string url = GetString(asset, "browser_download_url") ?? string.Empty;
            if (string.IsNullOrEmpty(url) || !name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) continue;

            string? digest = GetString(asset, "digest");
            string? sha = null;
            if (!string.IsNullOrWhiteSpace(digest) && digest!.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase))
                sha = digest["sha256:".Length..].Trim();

            long size = 0;
            if (asset.TryGetProperty("size", out JsonElement sizeElement) && sizeElement.TryGetInt64(out long parsed))
                size = parsed;

            var candidate = new UpdateAsset(name, url, size, sha);
            bool preferred = name.Contains("win64", StringComparison.OrdinalIgnoreCase);
            if (best is null || (preferred && !best.Name.Contains("win64", StringComparison.OrdinalIgnoreCase)))
                best = candidate;
        }
        return best;
    }

    private static string? GetString(JsonElement element, string name) =>
        element.TryGetProperty(name, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? TrimNotes(string? notes)
    {
        if (string.IsNullOrWhiteSpace(notes)) return null;
        string trimmed = notes.Trim();
        return trimmed.Length <= 4000 ? trimmed : trimmed[..4000] + "\n\n…";
    }

    // -- Small utilities -------------------------------------------------------------

    public static string NormalizeVersionText(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return string.Empty;
        string value = text.Trim();
        if (value.StartsWith('v') || value.StartsWith('V')) value = value[1..];
        int cut = value.IndexOfAny(new[] { '-', '+', ' ' });
        return cut >= 0 ? value[..cut] : value;
    }

    private static string SafeName(string text)
    {
        string safe = Regex.Replace(text, "[^A-Za-z0-9._-]+", "-");
        return safe.Length == 0 ? "update" : safe;
    }

    // The detached updater helper. It waits for Wordfall to exit, retries the file copy
    // (the WebView2 host can hold a DLL for a moment), then restarts the new exe.
    private const string InstallerScript = """
param(
  [int]$ParentPid = 0,
  [string]$Staged = '',
  [string]$Target = '',
  [string]$Log = '',
  [switch]$NoStart
)

$ErrorActionPreference = 'Continue'

function Write-UpdateLog([string]$message) {
  try {
    $dir = Split-Path -Parent $Log
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    Add-Content -Path $Log -Value ((Get-Date -Format o) + ' ' + $message)
  } catch { }
}

Write-UpdateLog "update start parent=$ParentPid staged=$Staged target=$Target"

$deadline = (Get-Date).AddSeconds(90)
while ($ParentPid -gt 0 -and (Get-Date) -lt $deadline) {
  $process = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
  if (-not $process) { break }
  Start-Sleep -Milliseconds 250
}
Start-Sleep -Milliseconds 400

$copied = $false
for ($attempt = 0; $attempt -lt 40 -and -not $copied; $attempt++) {
  try {
    Copy-Item -Path (Join-Path $Staged '*') -Destination $Target -Recurse -Force -ErrorAction Stop
    $copied = $true
  } catch {
    Write-UpdateLog ("copy retry " + $attempt + ": " + $_.Exception.Message)
    Start-Sleep -Milliseconds 350
  }
}

if (-not $copied) {
  Write-UpdateLog 'update FAILED: could not replace the installed files'
  exit 1
}

$exe = Join-Path $Target 'Wordfall.exe'
if (-not (Test-Path $exe)) {
  Write-UpdateLog 'update FAILED: Wordfall.exe missing after copy'
  exit 1
}

Write-UpdateLog 'update copied; cleaning up staging'
try { Remove-Item -Recurse -Force (Split-Path -Parent $Staged) -ErrorAction SilentlyContinue } catch { }

if (-not $NoStart) {
  Write-UpdateLog 'restarting Wordfall'
  Start-Process -FilePath $exe -WorkingDirectory $Target
}

Write-UpdateLog 'update done'
try { Remove-Item -Force $PSCommandPath -ErrorAction SilentlyContinue } catch { }
""";
}

internal sealed class UpdateAsset(string name, string downloadUrl, long size, string? sha256)
{
    public string Name { get; } = name;
    public string DownloadUrl { get; } = downloadUrl;
    public long Size { get; } = size;
    public string? Sha256 { get; } = sha256;
}

internal sealed class UpdateCheckResult
{
    public bool Ok { get; set; }
    public string Current { get; set; } = string.Empty;
    public string? Latest { get; set; }
    public string? Tag { get; set; }
    public string? Title { get; set; }
    public string? ReleaseUrl { get; set; }
    public bool Available { get; set; }
    public string? AssetName { get; set; }
    public string? AssetUrl { get; set; }
    public long AssetSize { get; set; }
    public string? AssetSha256 { get; set; }
    public string? Notes { get; set; }
    public string? Error { get; set; }

    public string ToJson() => JsonSerializer.Serialize(this, new JsonSerializerOptions
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    });
}

internal static class AppVersion
{
    public static string Current { get; } = ReadCurrent();

    public static bool IsNewer(string candidate, string current)
    {
        (int Major, int Minor, int Patch)? remote = Parse(candidate);
        (int Major, int Minor, int Patch)? local = Parse(current);
        if (remote is null || local is null) return false;
        return Compare(remote.Value, local.Value) > 0;
    }

    public static (int Major, int Minor, int Patch)? Parse(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        Match match = Regex.Match(Updater.NormalizeVersionText(text), @"^(?<major>\d+)(?:\.(?<minor>\d+))?(?:\.(?<patch>\d+))?");
        if (!match.Success) return null;
        int major = int.Parse(match.Groups["major"].Value);
        int minor = match.Groups["minor"].Success ? int.Parse(match.Groups["minor"].Value) : 0;
        int patch = match.Groups["patch"].Success ? int.Parse(match.Groups["patch"].Value) : 0;
        return (major, minor, patch);
    }

    private static int Compare((int Major, int Minor, int Patch) a, (int Major, int Minor, int Patch) b)
    {
        if (a.Major != b.Major) return a.Major.CompareTo(b.Major);
        if (a.Minor != b.Minor) return a.Minor.CompareTo(b.Minor);
        return a.Patch.CompareTo(b.Patch);
    }

    private static string ReadCurrent()
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        string? informational = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        string normalized = Updater.NormalizeVersionText(informational);
        if (!string.IsNullOrEmpty(normalized)) return normalized;
        return Updater.NormalizeVersionText(assembly.GetName().Version?.ToString()) is { Length: > 0 } version
            ? version
            : "0.0.0";
    }
}
