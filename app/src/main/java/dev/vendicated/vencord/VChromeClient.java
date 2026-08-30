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

    private static final int RECORD_AUDIO_REQUEST_CODE = 4242;

    private final MainActivity activity;

    /*
     * WebView microphone request is kept alive while Android
     * asks for RECORD_AUDIO permission.
     */
    private PermissionRequest pendingWebPermissionRequest;

    public VChromeClient(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage msg) {

        String m = String.format(
                Locale.ENGLISH,
                "[Javascript] %s @ %d: %s",
                msg.message(),
                msg.lineNumber(),
                msg.sourceId()
        );

        switch (msg.messageLevel()) {

            case DEBUG:
                Logger.d(m);
                break;

            case ERROR:
                Logger.e(m);
                break;

            case WARNING:
                Logger.w(m);
                break;

            default:
                Logger.i(m);
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

        Uri[] unused = null;

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
     * MICROPHONE
     * ============================================================
     *
     * Discord WebView requests microphone using:
     *
     * navigator.mediaDevices.getUserMedia({ audio: true })
     *
     * Android permission and WebView permission are handled here.
     */
    @Override
    public void onPermissionRequest(
            PermissionRequest request
    ) {

        boolean wantsAudio = false;

        String[] resources = request.getResources();

        if (resources != null) {

            for (String resource : resources) {

                if (
                        PermissionRequest
                                .RESOURCE_AUDIO_CAPTURE
                                .equals(resource)
                ) {

                    wantsAudio = true;
                    break;
                }
            }
        }

        /*
         * We only handle microphone requests.
         */
        if (!wantsAudio) {

            request.deny();

            return;
        }

        /*
         * Check Android microphone permission.
         */
        boolean hasAndroidPermission =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                        || activity.checkSelfPermission(
                                Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED;

        /*
         * Android microphone permission already exists.
         * Give WebView microphone access immediately.
         */
        if (hasAndroidPermission) {

            grantAudio(request);

            return;
        }

        /*
         * Replace an old pending request if necessary.
         */
        if (pendingWebPermissionRequest != null) {

            try {
                pendingWebPermissionRequest.deny();
            } catch (Exception ignored) {
            }
        }

        /*
         * Keep the WebView request alive.
         */
        pendingWebPermissionRequest = request;

        /*
         * Ask Android for RECORD_AUDIO.
         */
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {

            activity.runOnUiThread(
                    new Runnable() {

                        @Override
                        public void run() {

                            /*
                             * Check one more time in case permission
                             * was granted between the checks.
                             */
                            boolean alreadyGranted =
                                    activity.checkSelfPermission(
                                            Manifest.permission.RECORD_AUDIO
                                    )
                                            == PackageManager.PERMISSION_GRANTED;

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
            );

        } else {

            /*
             * Android < 6 has no runtime permission system.
             */
            PermissionRequest pending =
                    pendingWebPermissionRequest;

            pendingWebPermissionRequest = null;

            if (pending != null) {
                grantAudio(pending);
            }
        }
    }

    /*
     * Grant only microphone capture to WebView.
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
     * MainActivity must forward Android's permission result here.
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
