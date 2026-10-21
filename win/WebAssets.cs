using System.Reflection;

namespace Wordfall;

/// <summary>
/// The four classic game files served from https://wordfall.local/. They are embedded
/// into the exe at build time, so the published folder has no loose web assets.
/// </summary>
internal static class WebAssets
{
    private const string ResourcePrefix = "Wordfall.web.";

    private static readonly Dictionary<string, (string ResourceName, string ContentType)> Map =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["index.html"] = ("index.html", "text/html; charset=utf-8"),
            ["style.css"] = ("style.css", "text/css; charset=utf-8"),
            ["words.js"] = ("words.js", "application/javascript; charset=utf-8"),
            ["game.js"] = ("game.js", "application/javascript; charset=utf-8"),
        };

    private static readonly Dictionary<string, (byte[] Bytes, string ContentType)> Files = Load();

    public static bool TryGet(string path, out byte[] bytes, out string contentType)
    {
        if (Files.TryGetValue(path, out var file))
        {
            bytes = file.Bytes;
            contentType = file.ContentType;
            return true;
        }

        bytes = Array.Empty<byte>();
        contentType = string.Empty;
        return false;
    }

    /// <summary>Maps a request URI to a logical file name ("/" and "" become "index.html").</summary>
    public static string NormalizeRequestPath(string uri)
    {
        string path;
        try
        {
            path = new Uri(uri).AbsolutePath;
        }
        catch (UriFormatException)
        {
            return string.Empty;
        }

        path = Uri.UnescapeDataString(path).TrimStart('/');
        return path.Length == 0 ? "index.html" : path;
    }

    private static Dictionary<string, (byte[] Bytes, string ContentType)> Load()
    {
        Assembly assembly = Assembly.GetExecutingAssembly();
        var result = new Dictionary<string, (byte[], string)>(StringComparer.OrdinalIgnoreCase);

        foreach (var (fileName, entry) in Map)
        {
            string resourceName = ResourcePrefix + entry.ResourceName;
            using Stream? stream = assembly.GetManifestResourceStream(resourceName)
                ?? throw new InvalidOperationException(
                    $"Embedded resource '{resourceName}' is missing. Present resources: " +
                    string.Join(", ", assembly.GetManifestResourceNames()));

            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            result[fileName] = (buffer.ToArray(), entry.ContentType);
        }

        return result;
    }
}
