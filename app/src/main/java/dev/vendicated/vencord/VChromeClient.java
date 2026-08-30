package dev.vendicated.vencord;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.webkit.*;

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

        var m = String.format(
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

        if (activity.filePathCallback != null)
            activity.filePathCallback.onReceiveValue(null);

        activity.filePathCallback = filePathCallback;

        var i = fileChooserParams.createIntent();

        try {

            activity.startActivityForResult(
                    i,
                    MainActivity.FILECHOOSER_RESULTCODE
            );

        } catch (ActivityNotFoundException ex) {

            activity.filePathCallback = null;
            return false;
        }

        return true;
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {

        boolean wantsAudio = false;

        for (String resource : request.getResources()) {

            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                wantsAudio = true;
                break;
            }
        }

        // Only handle microphone here.
        if (!wantsAudio) {
            request.deny();
            return;
        }

        boolean hasAndroidPermission =
                Build.VERSION.SDK_INT < 23
                        || activity.checkSelfPermission(
                                Manifest.permission.RECORD_AUDIO
                        ) == PackageManager.PERMISSION_GRANTED;

        if (hasAndroidPermission) {

            request.grant(
                    new String[]{
                            PermissionRequest.RESOURCE_AUDIO_CAPTURE
                    }
            );

            return;
        }

        // Hold WebView request while Android permission dialog is open.
        if (pendingWebPermissionRequest != null) {
            pendingWebPermissionRequest.deny();
        }

        pendingWebPermissionRequest = request;

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

        if (requestCode != RECORD_AUDIO_REQUEST_CODE ||
                pendingWebPermissionRequest == null)
            return;

        var request = pendingWebPermissionRequest;

        pendingWebPermissionRequest = null;

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
