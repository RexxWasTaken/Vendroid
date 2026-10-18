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
        if (!isTrustedDiscordOrigin(request)) {
            request.deny();
            return;
        }

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

        if (hasAudioCapturePermission()) {
            grantAudioCapture(request);
            return;
        }

        if (pendingAudioRequest != null) {
            pendingAudioRequest.deny();
        }
        pendingAudioRequest = request;
        try {
            activity.requestPermissions(
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    AUDIO_PERMISSION_REQUEST_CODE
            );
        } catch (RuntimeException ex) {
            pendingAudioRequest = null;
            request.deny();
            Logger.e("Failed to request Android microphone permission", ex);
        }
    }

    @Override
    public void onPermissionRequestCanceled(PermissionRequest request) {
        if (pendingAudioRequest == request) {
            pendingAudioRequest = null;
        }
    }

    private boolean isTrustedDiscordOrigin(PermissionRequest request) {
        Uri origin = request.getOrigin();
        String host = origin.getHost();
        if (!"https".equalsIgnoreCase(origin.getScheme()) || host == null) {
            return false;
        }

        String normalizedHost = host.toLowerCase(Locale.ROOT);
        return "discord.com".equals(normalizedHost) || normalizedHost.endsWith(".discord.com");
    }

    public void onAndroidPermissionResult(
            int requestCode,
            String[] permissions,
            int[] grantResults
    ) {
        if (requestCode != AUDIO_PERMISSION_REQUEST_CODE || pendingAudioRequest == null) {
            return;
        }

        PermissionRequest request = pendingAudioRequest;
        pendingAudioRequest = null;
        boolean audioPermissionGranted = false;
        if (permissions != null && grantResults != null) {
            for (int i = 0; i < permissions.length && i < grantResults.length; i++) {
                if (Manifest.permission.RECORD_AUDIO.equals(permissions[i])
                        && grantResults[i] == PackageManager.PERMISSION_GRANTED) {
                    audioPermissionGranted = true;
                    break;
                }
            }
        }

        if (audioPermissionGranted && hasAudioCapturePermission()) {
            grantAudioCapture(request);
        } else {
            request.deny();
        }
    }

    public void onActivityDestroyed() {
        if (pendingAudioRequest != null) {
            pendingAudioRequest.deny();
            pendingAudioRequest = null;
        }
    }

    private boolean hasAudioCapturePermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    private void grantAudioCapture(PermissionRequest request) {
        if (!hasAudioCapturePermission()) {
            request.deny();
            return;
        }

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
