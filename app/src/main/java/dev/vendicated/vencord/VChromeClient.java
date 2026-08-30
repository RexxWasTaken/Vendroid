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

    public static final int RECORD_AUDIO_REQUEST_CODE = 4242;

    private final MainActivity activity;

    /*
     * WebView microphone request is kept here while Android
     * permission dialog is being shown.
     */
    private PermissionRequest pendingAudioRequest;

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

        try {

            IntentHelper.startActivityForResult(
                    activity,
                    fileChooserParams.createIntent(),
                    MainActivity.FILECHOOSER_RESULTCODE
            );

        } catch (ActivityNotFoundException ex) {

            activity.filePathCallback = null;

            Logger.e(
                    "No activity found for file chooser",
                    ex
            );

            return false;
        }

        return true;
    }

    /*
     * ============================================================
     * MICROPHONE PERMISSION
     * ============================================================
     *
     * Discord uses:
     *
     * navigator.mediaDevices.getUserMedia({
     *     audio: true
     * })
     *
     * WebView then calls this method.
     *
     * There are two permission layers:
     *
     * 1. Android RECORD_AUDIO permission
     * 2. WebView RESOURCE_AUDIO_CAPTURE permission
     *
     * Both are handled here.
     */
    @Override
    public void onPermissionRequest(
            PermissionRequest request
    ) {

        boolean wantsMicrophone = false;

        String[] resources =
                request.getResources();

        if (resources != null) {

            for (String resource : resources) {

                if (
                        PermissionRequest
                                .RESOURCE_AUDIO_CAPTURE
                                .equals(resource)
                ) {

                    wantsMicrophone = true;
                    break;
                }
            }
        }

        /*
         * We only handle microphone.
         *
         * Camera or unknown WebView permissions are denied
         * instead of being granted accidentally.
         */
        if (!wantsMicrophone) {

            request.deny();

            return;
        }

        /*
         * Android permission already granted?
         */
        boolean androidMicGranted =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                        || activity.checkSelfPermission(
                                Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED;

        if (androidMicGranted) {

            grantMicrophone(request);

            return;
        }

        /*
         * Another WebView request was waiting.
         * Deny the old one before replacing it.
         */
        if (pendingAudioRequest != null) {

            try {
                pendingAudioRequest.deny();
            } catch (Exception ignored) {
            }
        }

        pendingAudioRequest = request;

        /*
         * Ask Android for microphone permission.
         */
        activity.runOnUiThread(() -> {

            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {

                if (pendingAudioRequest != null) {

                    PermissionRequest pending =
                            pendingAudioRequest;

                    pendingAudioRequest = null;

                    grantMicrophone(pending);
                }

                return;
            }

            if (
                    activity.checkSelfPermission(
                            Manifest.permission.RECORD_AUDIO
                    ) == PackageManager.PERMISSION_GRANTED
            ) {

                if (pendingAudioRequest != null) {

                    PermissionRequest pending =
                            pendingAudioRequest;

                    pendingAudioRequest = null;

                    grantMicrophone(pending);
                }

                return;
            }

            activity.requestPermissions(
                    new String[]{
                            Manifest.permission.RECORD_AUDIO
                    },
                    RECORD_AUDIO_REQUEST_CODE
            );
        });
    }

    /*
     * Grant ONLY microphone to WebView.
     */
    private void grantMicrophone(
            PermissionRequest request
    ) {

        if (request == null) {
            return;
        }

        try {

            request.grant(
                    new String[]{
                            PermissionRequest
                                    .RESOURCE_AUDIO_CAPTURE
                    }
            );

            Logger.i(
                    "Vendroid microphone permission granted"
            );

        } catch (Exception ex) {

            Logger.e(
                    "Failed to grant microphone permission",
                    ex
            );
        }
    }

    /*
     * Called from MainActivity after Android's
     * RECORD_AUDIO permission dialog finishes.
     */
    public void onAndroidPermissionResult(
            int requestCode,
            int[] grantResults
    ) {

        if (
                requestCode
                        != RECORD_AUDIO_REQUEST_CODE
        ) {
            return;
        }

        PermissionRequest request =
                pendingAudioRequest;

        pendingAudioRequest = null;

        if (request == null) {
            return;
        }

        boolean granted =
                grantResults != null
                        && grantResults.length > 0
                        && grantResults[0]
                        == PackageManager.PERMISSION_GRANTED;

        if (granted) {

            grantMicrophone(request);

        } else {

            try {

                request.deny();

            } catch (Exception ignored) {
            }

            Logger.w(
                    "Vendroid microphone permission denied"
            );
        }
    }

    /*
     * If the WebView asks again after Android permission
     * has already been granted, it will immediately pass
     * through grantMicrophone().
     */
}
