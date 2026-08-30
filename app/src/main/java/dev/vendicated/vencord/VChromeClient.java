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

    private static final int RECORD_AUDIO_REQUEST_CODE = 4242;

    private final MainActivity activity;

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
     * Discord uses:
     *
     * navigator.mediaDevices.getUserMedia({ audio: true })
     *
     * We handle:
     * 1. Android RECORD_AUDIO permission
     * 2. WebView RESOURCE_AUDIO_CAPTURE permission
     */
    @Override
    public void onPermissionRequest(final PermissionRequest request) {

        if (request == null) {
            return;
        }

        boolean wantsAudio = false;

        String[] resources = request.getResources();

        if (resources != null) {
            for (String resource : resources) {
                if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                    wantsAudio = true;
                    break;
                }
            }
        }

        /*
         * Do not grant unknown WebView resources.
         */
        if (!wantsAudio) {
            try {
                request.deny();
            } catch (Exception ignored) {
            }
            return;
        }

        /*
         * Android 6.0+ requires runtime RECORD_AUDIO permission.
         */
        boolean androidAudioGranted =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                        || activity.checkSelfPermission(
                        Manifest.permission.RECORD_AUDIO
                ) == PackageManager.PERMISSION_GRANTED;

        /*
         * Android permission already granted.
         * Grant WebView microphone immediately.
         */
        if (androidAudioGranted) {
            grantAudio(request);
            return;
        }

        /*
         * Cancel previous pending WebView request.
         */
        if (pendingWebPermissionRequest != null) {
            try {
                pendingWebPermissionRequest.deny();
            } catch (Exception ignored) {
            }
        }

        pendingWebPermissionRequest = request;

        /*
         * Request Android microphone permission on UI thread.
         */
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {

                PermissionRequest pending =
                        pendingWebPermissionRequest;

                if (pending == null) {
                    return;
                }

                /*
                 * Permission might have been granted while
                 * this callback was waiting.
                 */
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                        || activity.checkSelfPermission(
                        Manifest.permission.RECORD_AUDIO
                ) == PackageManager.PERMISSION_GRANTED) {

                    pendingWebPermissionRequest = null;
                    grantAudio(pending);
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
     * Grant ONLY microphone capture to WebView.
     */
    private void grantAudio(PermissionRequest request) {

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

            /*
             * Logger in this project uses Logger.e(String),
             * so don't use Logger.e(String, Exception).
             */
            Logger.e(
                    "Vendroid: failed to grant microphone: "
                            + ex.getMessage()
            );
        }
    }

    /*
     * MainActivity should forward Android permission result here.
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
