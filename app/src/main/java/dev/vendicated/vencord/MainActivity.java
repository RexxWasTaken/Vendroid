package dev.vendicated.vencord;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.StrictMode;
import android.view.KeyEvent;
import android.webkit.ValueCallback;
import android.webkit.WebView;

import java.io.IOException;
import java.util.Objects;

public class MainActivity extends Activity {

    public static final int FILECHOOSER_RESULTCODE = 8485;

    private boolean wvInitialized = false;

    private WebView wv;

    private VChromeClient chromeClient;

    public ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(
            Bundle savedInstanceState
    ) {

        super.onCreate(savedInstanceState);

        WebView.setWebContentsDebuggingEnabled(
                BuildConfig.DEBUG
        );

        setContentView(
                R.layout.activity_main
        );

        wv = findViewById(
                R.id.webview
        );

        explodeAndroid();

        /*
         * WebView clients
         */
        wv.setWebViewClient(
                new VWebviewClient()
        );

        chromeClient =
                new VChromeClient(this);

        wv.setWebChromeClient(
                chromeClient
        );

        /*
         * Android microphone permission.
         *
         * If already granted, nothing happens.
         * If not granted, Android displays the normal
         * microphone permission dialog.
         */
        requestMicrophonePermission();

        var settings =
                wv.getSettings();

        settings.setJavaScriptEnabled(true);

        settings.setDomStorageEnabled(true);

        settings.setAllowFileAccess(true);

        /*
         * DESKTOP DISCORD
         */
        settings.setUserAgentString(
                Constants.DESKTOP_USER_AGENT
        );

        settings.setUseWideViewPort(true);

        settings.setLoadWithOverviewMode(true);

        /*
         * Allows audio playback without requiring
         * a separate user gesture.
         */
        settings.setMediaPlaybackRequiresUserGesture(
                false
        );

        /*
         * Existing Vencord native bridge.
         */
        wv.addJavascriptInterface(
                new VencordNative(
                        this,
                        wv
                ),
                "VencordMobileNative"
        );

        /*
         * Load all local JS:
         *
         * - Vencord
         * - mobile runtime
         * - desktop runtime
         * - custom plugins
         */
        try {

            HttpClient.fetchVencord(this);

        } catch (IOException ex) {

            Logger.e(
                    "Failed to fetch Vencord",
                    ex
            );

            return;
        }

        Intent intent =
                getIntent();

        if (Objects.equals(
                intent.getAction(),
                Intent.ACTION_VIEW
        )) {

            Uri data =
                    intent.getData();

            if (data != null) {
                handleUrl(data);
            }

        } else {

            wv.loadUrl(
                    "https://discord.com/app"
            );
        }

        wvInitialized = true;
    }

    private void requestMicrophonePermission() {

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {

            if (checkSelfPermission(
                    Manifest.permission.RECORD_AUDIO
            ) != PackageManager.PERMISSION_GRANTED) {

                requestPermissions(
                        new String[]{
                                Manifest.permission.RECORD_AUDIO
                        },
                        VChromeClient.RECORD_AUDIO_REQUEST_CODE
                );
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {

        super.onRequestPermissionsResult(
                requestCode,
                permissions,
                grantResults
        );

        if (chromeClient != null) {

            chromeClient.onAndroidPermissionResult(
                    requestCode,
                    grantResults
            );
        }
    }

    @Override
    public boolean onKeyDown(
            int keyCode,
            KeyEvent event
    ) {

        if (
                keyCode == KeyEvent.KEYCODE_BACK
                        && wv != null
        ) {

            runOnUiThread(() ->
                    wv.evaluateJavascript(
                            "typeof VencordMobile !== 'undefined' "
                                    + "? VencordMobile.onBackPress() "
                                    + ": false",
                            result -> {

                                if ("false".equals(result)) {
                                    MainActivity.this.onBackPressed();
                                }
                            }
                    )
            );

            return true;
        }

        return super.onKeyDown(
                keyCode,
                event
        );
    }

    @Override
    protected void onActivityResult(
            int requestCode,
            int resultCode,
            Intent intent
    ) {

        super.onActivityResult(
                requestCode,
                resultCode,
                intent
        );

        if (
                requestCode != FILECHOOSER_RESULTCODE
                        || filePathCallback == null
        ) {
            return;
        }

        if (
                resultCode != RESULT_OK
                        || intent == null
        ) {

            filePathCallback.onReceiveValue(
                    null
            );

        } else {

            Uri[] uris;

            try {

                var clipData =
                        intent.getClipData();

                if (clipData != null) {

                    uris =
                            new Uri[
                                    clipData.getItemCount()
                            ];

                    for (
                            int i = 0;
                            i < clipData.getItemCount();
                            i++
                    ) {

                        uris[i] =
                                clipData
                                        .getItemAt(i)
                                        .getUri();
                    }

                } else {

                    Uri data =
                            intent.getData();

                    uris =
                            data == null
                                    ? null
                                    : new Uri[]{
                                            data
                                    };
                }

            } catch (Exception ex) {

                Logger.e(
                        "Error during file upload",
                        ex
                );

                uris = null;
            }

            filePathCallback.onReceiveValue(
                    uris
            );
        }

        filePathCallback = null;
    }

    private void explodeAndroid() {

        StrictMode.setThreadPolicy(
                new StrictMode.ThreadPolicy.Builder()
                        .permitNetwork()
                        .build()
        );
    }

    public void handleUrl(
            Uri url
    ) {

        if (url == null) {
            return;
        }

        if (
                url.getAuthority() == null
                        || !url.getAuthority()
                        .equals("discord.com")
        ) {
            return;
        }

        if (!wvInitialized) {

            wv.loadUrl(
                    url.toString()
            );

        } else {

            String path =
                    url.getPath();

            if (path == null) {
                path = "/";
            }

            String safePath =
                    path.replace(
                            "\\",
                            "\\\\"
                    ).replace(
                            "\"",
                            "\\\""
                    );

            wv.evaluateJavascript(
                    "Vencord.Webpack.Common.NavigationRouter"
                            + ".transitionTo(\""
                            + safePath
                            + "\")",
                    null
            );
        }
    }

    @Override
    protected void onNewIntent(
            Intent intent
    ) {

        super.onNewIntent(intent);

        setIntent(intent);

        Uri data =
                intent.getData();

        if (data != null) {
            handleUrl(data);
        }
    }
}
