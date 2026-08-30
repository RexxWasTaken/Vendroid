package dev.vendicated.vencord;

import android.Manifest;
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

            activity.startActivityForResult(
                    fileChooserParams.createIntent(),
                    MainActivity.FILECHOOSER_RESULTCODE
            );

        } catch (ActivityNotFoundException ex) {

            activity.filePathCallback = null;

            Logger.e(
                    "Unable to open file chooser",
                    ex
            );

            return false;
        }

        return true;
    }

    /*
     * Discord microphone permission.
     *
     * Discord calls:
     *
     * navigator.mediaDevices.getUserMedia({
     *     audio: true
     * })
     *
     * WebView then reaches this method.
     */
    @Override
    public void onPermissionRequest(
            PermissionRequest request
    ) {

        boolean audioRequested = false;

        String[] resources = request.getResources();

        if (resources != null) {

            for (String resource : resources) {

                if (
                        PermissionRequest
                                .RESOURCE_AUDIO_CAPTURE
                                .equals(resource)
                ) {

                    audioRequested = true;
                    break;
                }
            }
        }

        /*
         * Only microphone is handled.
         * Do not grant camera or unknown resources.
         */
        if (!audioRequested) {

            request.deny();

            return;
        }

        /*
         * Everything below runs on Android's UI thread.
         */
        activity.runOnUiThread(() -> {

            if (activity.isFinishing()) {

                request.deny();

                return;
            }

            /*
             * Check Android RECORD_AUDIO permission.
             */
            boolean hasMicPermission =
                    Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                            || activity.checkSelfPermission(
                                    Manifest.permission.RECORD_AUDIO
                            ) == PackageManager.PERMISSION_GRANTED;

            /*
             * Android permission already granted.
             * Give WebView microphone access immediately.
             */
            if (hasMicPermission) {

                grantMicrophone(request);

                return;
            }

            /*
             * Keep this WebView permission request alive
             * while Android displays its permission dialog.
             */
            if (pendingAudioRequest != null) {

                try {
                    pendingAudioRequest.deny();
                } catch (Exception ignored) {
                }
            }

            pendingAudioRequest = request;

            /*
             * Android microphone permission popup.
             */
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {

                activity.requestPermissions(
                        new String[]{
                                Manifest.permission.RECORD_AUDIO
                        },
                        RECORD_AUDIO_REQUEST_CODE
                );

            } else {

                /*
                 * Pre-Marshmallow devices do not have
                 * runtime permissions.
                 */
                PermissionRequest pending =
                        pendingAudioRequest;

                pendingAudioRequest = null;

                if (pending != null) {
                    grantMicrophone(pending);
                }
            }
        });
    }

    /*
     * Give WebView ONLY microphone capture permission.
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
                    "Microphone granted to WebView"
            );

        } catch (Exception ex) {

            Logger.e(
                    "Failed to grant WebView microphone",
                    ex
            );
        }
    }

    /*
     * MainActivity calls this after Android's
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

            /*
             * Android permission OK.
             * Now allow WebView audio capture.
             */
            grantMicrophone(request);

        } else {

            /*
             * User denied Android microphone permission.
             */
            try {
                request.deny();
            } catch (Exception ignored) {
            }

            Logger.w(
                    "Android microphone permission denied"
            );
        }
    }
        }
