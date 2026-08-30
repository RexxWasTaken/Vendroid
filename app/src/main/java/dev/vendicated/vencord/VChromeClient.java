package dev.vendicated.vencord;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import java.util.Locale;

public class VChromeClient extends WebChromeClient {

    /*
     * MainActivity accesses this constant.
     * DO NOT make this private.
     */
    public static final int RECORD_AUDIO_REQUEST_CODE = 4242;

    private final MainActivity activity;

    /*
     * Keeps the WebView microphone request alive while Android
     * asks for RECORD_AUDIO permission.
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
            WebChromeClient.FileChooserParams fileChooserParams
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
     * MICROPHONE PERMISSION
     * ============================================================
     *
     * Handles Discord/WebView:
     *
     * navigator.mediaDevices.getUserMedia({
     *     audio: true
     * })
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
         * Only handle microphone requests.
         */
        if (!wantsAudio) {

            try {
                request.deny();
            } catch (Exception ignored) {
            }

            return;
        }

        /*
         * Android versions below 6.0 don't use runtime
         * permissions.
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
         * Already allowed by Android.
         * Grant microphone to WebView immediately.
         */
        if (hasAndroidPermission) {

            grantAudio(request);

            return;
        }

        /*
         * Cancel an older pending request.
         */
        if (pendingWebPermissionRequest != null) {

            try {
                pendingWebPermissionRequest.deny();
            } catch (Exception ignored) {
            }
        }

        /*
         * Save the current WebView request.
         */
        pendingWebPermissionRequest = request;

        /*
         * Ask Android for microphone permission.
         */
        activity.runOnUiThread(new Runnable() {

            @Override
            public void run() {

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
     * Called by MainActivity after Android finishes
     * the RECORD_AUDIO permission dialog.
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
