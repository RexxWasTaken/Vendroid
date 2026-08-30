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
                    "File chooser failed",
                    ex
            );

            return false;
        }

        return true;
    }

    @Override
    public void onPermissionRequest(
            PermissionRequest request
    ) {

        boolean audioRequested = false;

        for (String resource : request.getResources()) {

            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                audioRequested = true;
                break;
            }
        }

        /*
         * Only microphone is handled here.
         */
        if (!audioRequested) {
            request.deny();
            return;
        }

        boolean microphoneGranted =
                Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                        || activity.checkSelfPermission(
                                Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED;

        if (microphoneGranted) {

            request.grant(
                    new String[]{
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    }
            );

            return;
        }

        /*
         * Keep the WebView request pending while Android
         * shows the microphone permission dialog.
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
    }

    public void onAndroidPermissionResult(
            int requestCode,
            int[] grantResults
    ) {

        if (
                requestCode != RECORD_AUDIO_REQUEST_CODE
                        || pendingAudioRequest == null
        ) {
            return;
        }

        PermissionRequest request =
                pendingAudioRequest;

        pendingAudioRequest = null;

        boolean granted =
                grantResults.length > 0
                        && grantResults[0]
                        == PackageManager.PERMISSION_GRANTED;

        if (granted) {

            request.grant(
                    new String[]{
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    }
            );

        } else {

            request.deny();
        }
    }
}
