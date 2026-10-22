package com.boci0.wordfall;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // records, settings and custom stages live in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(0xFF008080);
        web.loadUrl("file:///android_asset/index.html");
        web.requestFocus();
    }

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
