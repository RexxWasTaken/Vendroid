package dev.vendicated.vencord;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.pm.PackageManager;
import android.os.Build;
import android.net.Uri;
import android.webkit.*;

import java.util.Locale;

public class VChromeClient extends WebChromeClient {
    private static final int AUDIO_PERMISSION_REQUEST_CODE = 0x5245;

    private final MainActivity activity;
    private PermissionRequest pendingAudioRequest;

    public VChromeClient(MainActivity activity) {
        this.activity = activity;
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {
        boolean requestsAudio = false;
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                requestsAudio = true;
                break;
            }
        }

        if (!requestsAudio) {
            request.deny();
            return;
        }

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED) {
            grantAudioCapture(request);
            return;
        }

        if (pendingAudioRequest != null) {
            pendingAudioRequest.deny();
        }
        pendingAudioRequest = request;
        activity.requestPermissions(
                new String[]{Manifest.permission.RECORD_AUDIO},
                AUDIO_PERMISSION_REQUEST_CODE
        );
    }

    @Override
    public void onPermissionRequestCanceled(PermissionRequest request) {
        if (pendingAudioRequest == request) {
            pendingAudioRequest = null;
        }
    }

    public void onAndroidPermissionResult(int requestCode, int[] grantResults) {
        if (requestCode != AUDIO_PERMISSION_REQUEST_CODE || pendingAudioRequest == null) {
            return;
        }

        PermissionRequest request = pendingAudioRequest;
        pendingAudioRequest = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            grantAudioCapture(request);
        } else {
            request.deny();
        }
    }

    private void grantAudioCapture(PermissionRequest request) {
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                return;
            }
        }
        request.deny();
    }

    @Override
    public boolean onConsoleMessage(ConsoleMessage msg) {
        var m = String.format(Locale.ENGLISH, "[Javascript] %s @ %d: %s", msg.message(), msg.lineNumber(), msg.sourceId());
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
    public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
        if (activity.filePathCallback != null)
            activity.filePathCallback.onReceiveValue(null);

        activity.filePathCallback = filePathCallback;

        var i = fileChooserParams.createIntent();
        try {
            activity.startActivityForResult(i, MainActivity.FILECHOOSER_RESULTCODE);
        } catch (ActivityNotFoundException ex) {
            activity.filePathCallback = null;
            return false;
        }

        return true;
    }
}
