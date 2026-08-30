package dev.vendicated.vencord;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.ConsoleMessage;
import android.webkit.FileChooserParams;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import java.util.Locale;

public class VChromeClient extends WebChromeClient {

    /*
     * IMPORTANT:
     * MainActivity accesses this constant, so it MUST be public.
     */
    public static final int RECORD_AUDIO_REQUEST_CODE = 4242;

    private final MainActivity activity;

    /*
     * Keep the WebView permission request alive while Android
     * shows the RECORD_AUDIO permission dialog.
     */
    private PermissionRequest pendingWebPermissionRequest;

    public VChromeClient(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage msg) {

        String message = String.format(
                Locale.ENGLISH,
                "[Javascript] %s @ %d: %s",
                msg.message(),
                msg.lineNumber(),
                msg.sourceId()
        );

        switch (msg.messageLevel()) {

            case DEBUG:
                Logger.d(message);
                break;

            case ERROR:
                Logger.e(message);
                break;

            case WARNING:
                Logger.w(message);
                break;

            default:
                Logger.i(message);
                break;
        }

        return true;
    }

    @Override
    public boolean onShowFileChooser(
            WebView webView,
            ValueCallback<Uri[]> filePathCallback,
            FileChooserParams fileChooserParams
    ) {

        if (activity.filePathCallback != null) {
            activity.filePathCallback.onReceiveValue(null);
        }

        activity.filePathCallback = filePathCallback;

        android.content.Intent intent =
                fileChooserParams.createIntent();

        try {

            activity.startActivityForResult(
                    intent,
                    MainActivity.FILECHOOSER_RESULTCODE
            );

        } catch (ActivityNotFoundException ex) {

            activity.filePathCallback = null;

            return false;
        }

        return true;
    }

    /*
     * ============================================================
     * WEBVIEW MICROPHONE PERMISSION
     * ============================================================
     *
     * Discord requests microphone through:
     *
     * navigator.mediaDevices.getUserMedia({
     *     audio: true
     * })
     *
     * Android RECORD_AUDIO permission and WebView's
     * RESOURCE_AUDIO_CAPTURE permission are handled here.
     */
    @Override
    public void onPermissionRequest(
            final PermissionRequest request
    ) {

        if (request == null) {
            return;
        }

        boolean wantsAudio = false;

        String[] resources = request.getResources();

        if (resources != null) {

            for (String resource : resources) {

                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(
                        resource
                )) {

                    wantsAudio = true;
                    break;
                }
            }
        }

        /*
         * We only handle microphone permission.
         */
        if (!wantsAudio) {

            try {
                request.deny();
            } catch (Exception ignored) {
            }

            return;
        }

        /*
         * Android < 6.0 does not have runtime permissions.
         */
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {

            grantAudio(request);

            return;
        }

        /*
         * Check Android RECORD_AUDIO permission.
         */
        boolean hasAndroidPermission =
                activity.checkSelfPermission(
                        Manifest.permission.RECORD_AUDIO
                ) == PackageManager.PERMISSION_GRANTED;

        /*
         * Android permission already granted.
         * Give microphone access directly to WebView.
         */
        if (hasAndroidPermission) {

            grantAudio(request);

            return;
        }

        /*
         * Cancel any previous pending request.
         */
        if (pendingWebPermissionRequest != null) {

            try {
                pendingWebPermissionRequest.deny();
            } catch (Exception ignored) {
            }
        }

        /*
         * Keep this exact WebView request alive.
         */
        pendingWebPermissionRequest = request;

        /*
         * Ask Android for microphone permission.
         */
        activity.runOnUiThread(new Runnable() {

            @Override
            public void run() {

                /*
                 * Permission could have been granted between
                 * the previous check and this point.
                 */
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {

                    boolean alreadyGranted =
                            activity.checkSelfPermission(
                                    Manifest.permission.RECORD_AUDIO
                            ) == PackageManager.PERMISSION_GRANTED;

                    if (alreadyGranted) {

                        PermissionRequest pending =
                                pendingWebPermissionRequest;

                        pendingWebPermissionRequest = null;

                        if (pending != null) {
                            grantAudio(pending);
                        }

                        return;
                    }

                    activity.requestPermissions(
                            new String[]{
                                    Manifest.permission.RECORD_AUDIO
                            },
                            RECORD_AUDIO_REQUEST_CODE
                    );
                }
            }
        });
    }

    /*
     * Grant microphone capture to WebView.
     */
    private void grantAudio(
            PermissionRequest request
    ) {

        if (request == null) {
            return;
        }

        try {

            request.grant(
                    new String[]{
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    }
            );

            Logger.i(
                    "Vendroid: WebView microphone granted"
            );

        } catch (Exception ex) {

            Logger.e(
                    "Vendroid: failed to grant microphone",
                    ex
            );
        }
    }

    /*
     * MainActivity calls this from onRequestPermissionsResult().
     */
    public void onAndroidPermissionResult(
            int requestCode,
            int[] grantResults
    ) {

        if (requestCode != RECORD_AUDIO_REQUEST_CODE) {
            return;
        }

        PermissionRequest request =
                pendingWebPermissionRequest;

        pendingWebPermissionRequest = null;

        if (request == null) {
            return;
        }

        boolean granted =
                grantResults != null
                        && grantResults.length > 0
                        && grantResults[0]
                        == PackageManager.PERMISSION_GRANTED;

        if (granted) {

            grantAudio(request);

        } else {

            try {
                request.deny();
            } catch (Exception ignored) {
            }

            Logger.w(
                    "Vendroid: microphone permission denied"
            );
        }
    }
        }
