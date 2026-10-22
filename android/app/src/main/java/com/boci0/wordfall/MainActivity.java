package com.boci0.wordfall;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class MainActivity extends Activity {
    private static final String LATEST_API = "https://api.github.com/repos/Boci0/wordfall/releases/latest";
    private static final String APK_NAME = "Wordfall-android.apk";

    private WebView web;
    private boolean updating;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // records, settings and custom stages live in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Bridge(), "WordfallAndroid");
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(0xFF008080);
        web.loadUrl("file:///android_asset/index.html");
        web.requestFocus();

        // Like the Windows app: look for a newer release shortly after launch, quietly.
        web.postDelayed(() -> checkForUpdate(false), 4000);
    }

    /** Called from the game's Help > Check for Updates. */
    private class Bridge {
        @JavascriptInterface
        public void checkUpdate() {
            runOnUiThread(() -> checkForUpdate(true));
        }
    }

    // -- In-app updater -------------------------------------------------------------

    private void checkForUpdate(boolean interactive) {
        if (updating) return;
        updating = true;
        new Thread(() -> {
            try {
                JSONObject release = new JSONObject(httpGet(LATEST_API));
                String tag = release.getString("tag_name");
                String current = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                String url = null;
                JSONArray assets = release.getJSONArray("assets");
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    if (APK_NAME.equals(a.getString("name"))) url = a.getString("browser_download_url");
                }
                if (url == null || !isNewer(tag, current)) {
                    updating = false;
                    if (interactive) runOnUiThread(() -> toast("Wordfall " + current + " is up to date."));
                    return;
                }
                final String apkUrl = url;
                runOnUiThread(() -> new AlertDialog.Builder(this)
                    .setTitle("Wordfall update")
                    .setMessage("Wordfall " + tag.replaceFirst("^v", "") + " is available (you have " + current + "). Download and install it now?")
                    .setPositiveButton("Update", (d, w) -> download(apkUrl))
                    .setNegativeButton("Later", (d, w) -> updating = false)
                    .setOnCancelListener(d -> updating = false)
                    .show());
            } catch (Exception e) {
                updating = false;
                if (interactive) runOnUiThread(() -> toast("Could not check for updates: " + e.getMessage()));
            }
        }).start();
    }

    private void download(String apkUrl) {
        AlertDialog progress = new AlertDialog.Builder(this)
            .setTitle("Wordfall update").setMessage("Downloading 0%").setCancelable(false).show();
        new Thread(() -> {
            try {
                File dir = new File(getCacheDir(), "updates");
                dir.mkdirs();
                File apk = new File(dir, APK_NAME);
                HttpURLConnection c = open(apkUrl);
                int total = c.getContentLength();
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[16384];
                    long done = 0;
                    int n;
                    int last = -1;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : 0;
                        if (pct != last) {
                            last = pct;
                            runOnUiThread(() -> progress.setMessage("Downloading " + pct + "%"));
                        }
                    }
                }
                runOnUiThread(() -> { progress.dismiss(); install(apk); });
            } catch (Exception e) {
                runOnUiThread(() -> { progress.dismiss(); toast("Download failed: " + e.getMessage()); });
            } finally {
                updating = false;
            }
        }).start();
    }

    private void install(File apk) {
        if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
            toast("Allow Wordfall to install apps, then check for updates again.");
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName())));
            return;
        }
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".updates", apk);
        Intent i = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(i);
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(20000);
        c.setRequestProperty("User-Agent", "Wordfall-Android");
        c.setRequestProperty("Accept", "application/vnd.github+json");
        if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
        return c;
    }

    private static String httpGet(String url) throws Exception {
        try (InputStream in = open(url).getInputStream()) {
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toString("UTF-8");
        }
    }

    private static boolean isNewer(String tag, String current) {
        String[] a = tag.replaceFirst("^v", "").split("\\.");
        String[] b = current.split("\\.");
        for (int i = 0; i < Math.max(a.length, b.length); i++) {
            int x = i < a.length ? Integer.parseInt(a[i]) : 0;
            int y = i < b.length ? Integer.parseInt(b[i]) : 0;
            if (x != y) return x > y;
        }
        return false;
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    // -- Window ---------------------------------------------------------------------

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    // Back acts as Esc (pause / close dialog); on the main menu it leaves the app.
    @Override
    public void onBackPressed() {
        web.evaluateJavascript(
            "(window.__wordfall && window.__wordfall.state.phase) || ''",
            value -> {
                if ("\"menu\"".equals(value)) {
                    finish();
                } else {
                    web.evaluateJavascript(
                        "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))", null);
                }
            });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }
}
