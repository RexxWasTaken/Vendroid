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

    private PermissionRequest pendingAudioRequest;

    public VChromeClient(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage msg) {

        var message = String.format(
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

        var intent = fileChooserParams.createIntent();

        try {

            activity.startActivityForResult(
                    intent,
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
     * Discord/WebView calls this when JavaScript requests:
     *
     * navigator.mediaDevices.getUserMedia({
     *     audio: true
     * })
     *
     * Android has TWO permission layers:
     *
     * 1. Android RECORD_AUDIO permission
     * 2. WebView PermissionRequest
     *
     * Both must be granted.
     */
    @Override
    public void onPermissionRequest(
            PermissionRequest request
    ) {

        boolean wantsAudio = false;

        for (String resource : request.getResources()) {

            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                wantsAudio = true;
                break;
            }
        }

        /*
         * Do not automatically grant camera or unknown resources.
         */
        if (!wantsAudio) {
            request.deny();
            return;
        }

        activity.runOnUiThread(() -> {

            if (activity.isFinishing()) {
                request.deny();
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1
                    && activity.isDestroyed()) {

                request.deny();
                return;
            }

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
             * Keep this WebView request alive while Android displays
             * the RECORD_AUDIO permission dialog.
             */
            if (pendingAudioRequest != null) {
                pendingAudioRequest.deny();
            }

            pendingAudioRequest = request;

            activity.requestPermissions(
                    new String[]{
                            Manifest.permission.RECORD_AUDIO
                    },
                    RECORD_AUDIO_REQUEST_CODE
            );
        });
    }

    private void grantMicrophone(
            PermissionRequest request
    ) {

        /*
         * IMPORTANT:
         * Only grant AUDIO_CAPTURE.
         *
         * Do NOT grant the entire request blindly.
         */
        request.grant(
                new String[]{
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE
                }
        );
    }

    public void onAndroidPermissionResult(
            int requestCode,
            int[] grantResults
    ) {

        if (requestCode != RECORD_AUDIO_REQUEST_CODE) {
            return;
        }

        PermissionRequest request =
                pendingAudioRequest;

        pendingAudioRequest = null;

        if (request == null) {
            return;
        }

        boolean granted =
                grantResults.length > 0
                        && grantResults[0]
                        == PackageManager.PERMISSION_GRANTED;

        if (granted) {

            grantMicrophone(request);

        } else {

            request.deny();
        }
    }
}
