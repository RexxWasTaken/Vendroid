package dev.vendicated.vencord;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.os.StrictMode;
import android.view.KeyEvent;
import android.webkit.ValueCallback;
import android.webkit.WebView;
import android.webkit.PermissionRequest;

import java.io.IOException;
import java.util.Objects;

public class MainActivity extends Activity {
    public static final int FILECHOOSER_RESULTCODE = 8485;
    private static final int AUDIO_PERMISSION_REQUEST = 8486;
    private PermissionRequest pendingAudioRequest;
    private boolean wvInitialized = false;
    private WebView wv;

    public ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled") // mad? watch this swag
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // https://developer.chrome.com/docs/devtools/remote-debugging/webviews/
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        setContentView(R.layout.activity_main);

        wv = findViewById(R.id.webview);

        explodeAndroid();

        wv.setWebViewClient(new VWebviewClient());
        wv.setWebChromeClient(new VChromeClient(this));

        var s = wv.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setUserAgentString(s.getUserAgentString()
                .replaceFirst("\\(Linux; Android[^)]*\\)", "(X11; Linux x86_64)")
                .replace(" Version/4.0", "")
                .replace(" Mobile", ""));
        wv.setInitialScale(60);

        wv.addJavascriptInterface(new VencordNative(this, wv), "VencordMobileNative");

        try {
            HttpClient.fetchVencord(this);
        } catch (IOException ex) {
            Logger.e("Failed to fetch Vencord", ex);
            return;
        }

        Intent intent = getIntent();
        if (Objects.equals(intent.getAction(), Intent.ACTION_VIEW)) {
            Uri data = intent.getData();
            if (data != null) handleUrl(intent.getData());
        } else {
            wv.loadUrl("https://discord.com/app");
        }

        wvInitialized = true;
    }

    public void handleWebPermissionRequest(PermissionRequest request) {
        if (request == null) return;
        Uri origin = request.getOrigin();
        String host = origin == null ? null : origin.getHost();
        boolean trustedOrigin = origin != null && "https".equalsIgnoreCase(origin.getScheme())
                && ("discord.com".equalsIgnoreCase(host)
                || "ptb.discord.com".equalsIgnoreCase(host)
                || "canary.discord.com".equalsIgnoreCase(host));
        boolean audioRequested = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audioRequested = true;
        }
        if (!trustedOrigin || !audioRequested) {
            request.deny();
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            return;
        }
        if (pendingAudioRequest != null) pendingAudioRequest.deny();
        pendingAudioRequest = request;
        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION_REQUEST);
    }

    public void cancelWebPermissionRequest(PermissionRequest request) {
        if (pendingAudioRequest == request) pendingAudioRequest = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != AUDIO_PERMISSION_REQUEST) return;
        PermissionRequest request = pendingAudioRequest;
        pendingAudioRequest = null;
        if (request == null) return;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        } else {
            request.deny();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && wv != null) {
            runOnUiThread(() -> wv.evaluateJavascript("VencordMobile.onBackPress()", r -> {
                if ("false".equals(r))
                    this.onBackPressed ();
            }));
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent intent) {
        if (requestCode != FILECHOOSER_RESULTCODE || filePathCallback == null)
            return;

        if (resultCode != RESULT_OK || intent == null) {
            filePathCallback.onReceiveValue(null);
        } else {
            Uri[] uris;
            try {
                var clipData = intent.getClipData();
                if (clipData != null) { // multiple items
                    uris = new Uri[clipData.getItemCount()];
                    for (int i = 0; i < clipData.getItemCount(); i++) {
                        uris[i] = clipData.getItemAt(i).getUri();
                    }
                } else { // single item
                    uris = new Uri[] { intent.getData() };
                }
            } catch (Exception ex) {
                Logger.e("Error during file upload", ex);
                uris = null;
            }

            filePathCallback.onReceiveValue(uris);
        }
        filePathCallback = null;
    }

    private void explodeAndroid() {
        StrictMode.setThreadPolicy(
                new StrictMode.ThreadPolicy.Builder()
                        // trolley
                        .permitNetwork()
                        .build()
        );
    }

    public void handleUrl(Uri url) {
        if (url != null) {
            if (!url.getAuthority().equals("discord.com")) return;
            if (!wvInitialized) {
                wv.loadUrl(url.toString());
            } else {
                wv.evaluateJavascript("Vencord.Webpack.Common.NavigationRouter.transitionTo(\"" + url.getPath() + "\")", null);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null) handleUrl(data);
    }
}
