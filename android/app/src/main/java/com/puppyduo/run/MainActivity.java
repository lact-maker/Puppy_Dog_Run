package com.puppyduo.run;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.View;
import android.view.WindowManager;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> upload;
    private static final String DOMAIN = "appassets.androidplatform.net";
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        web = new WebView(this); setContentView(web);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setTextZoom(100);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(true);
        // The prototype can connect to a user-selected LAN HTTP server.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        web.setBackgroundColor(0xfffcf9f2);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!DOMAIN.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || !path.startsWith("/assets/") || path.contains("..")) return missing();
                String name = path.substring(8);
                String mime = name.endsWith(".html") ? "text/html" : name.endsWith(".mjs") || name.endsWith(".js") ? "text/javascript" : name.endsWith(".css") ? "text/css" : name.endsWith(".mp3") ? "audio/mpeg" : name.endsWith(".ogg") ? "audio/ogg" : name.endsWith(".wav") ? "audio/wav" : name.endsWith(".png") ? "image/png" : name.endsWith(".svg") ? "image/svg+xml" : "application/json";
                try {
                    Map<String,String> headers = new HashMap<>(); headers.put("Cache-Control", "no-cache");
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open(name));
                } catch (IOException e) { return missing(); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !DOMAIN.equals(request.getUrl().getHost());
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (upload != null) upload.onReceiveValue(null);
                upload = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT); intent.setType("image/*"); intent.addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(intent, 101); } catch (Exception e) { upload.onReceiveValue(null); upload = null; }
                return true;
            }
        });
        web.loadUrl("https://" + DOMAIN + "/assets/index.html");
    }
    private WebResourceResponse missing() { return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", new HashMap<>(), new ByteArrayInputStream(new byte[0])); }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 101 && upload != null) { upload.onReceiveValue(resultCode == RESULT_OK && data != null ? new Uri[]{data.getData()} : null); upload = null; }
    }
    @Override protected void onPause() { super.onPause(); web.evaluateJavascript("document.dispatchEvent(new Event('puppy-background'))", null); web.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override public void onBackPressed() { web.evaluateJavascript("document.dispatchEvent(new Event('puppy-back'))", null); }
    @Override protected void onDestroy() { if (upload != null) upload.onReceiveValue(null); web.destroy(); super.onDestroy(); }
}
