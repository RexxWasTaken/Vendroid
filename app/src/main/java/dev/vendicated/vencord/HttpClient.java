package dev.vendicated.vencord;

import android.app.Activity;

import androidx.annotation.NonNull;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Locale;

public class HttpClient {

    public static final class HttpException
            extends IOException {

        private final HttpURLConnection conn;
        private String message;

        public HttpException(HttpURLConnection conn) {
            this.conn = conn;
        }

        @Override
        @NonNull
        public String getMessage() {

            if (message == null) {

                try (var es = conn.getErrorStream()) {

                    message = String.format(
                            Locale.ENGLISH,
                            "%d: %s (%s)\n%s",
                            conn.getResponseCode(),
                            conn.getResponseMessage(),
                            conn.getURL().toString(),
                            readAsText(es)
                    );

                } catch (IOException ex) {

                    message =
                            "Error while building message lmao. Url is "
                                    + conn.getURL().toString();
                }
            }

            return message;
        }
    }

    public static String VencordRuntime;
    public static String VencordMobileRuntime;
    public static String VendroidDesktopRuntime;

    public static final java.util.List<String>
            CustomPluginScripts =
            new java.util.ArrayList<>();

    private static final String
            CUSTOM_PLUGIN_ASSET_DIR =
            "vencord/custom";

    public static void fetchVencord(
            Activity activity
    ) throws IOException {

        if (VencordRuntime != null)
            return;

        var res = activity.getResources();

        try (var is =
                     res.openRawResource(
                             R.raw.vencord_mobile
                     )) {

            VencordMobileRuntime =
                    readAsText(is);
        }

        try (var is =
                     res.openRawResource(
                             R.raw.vendroid_desktop
                     )) {

            VendroidDesktopRuntime =
                    readAsText(is);
        }

        loadCustomPlugins(activity);

        var conn =
                fetch(Constants.JS_BUNDLE_URL);

        try (var is = conn.getInputStream()) {

            VencordRuntime =
                    readAsText(is);
        }
    }

    private static void loadCustomPlugins(
            Activity activity
    ) {

        CustomPluginScripts.clear();

        var assets =
                activity.getAssets();

        String[] files;

        try {

            files =
                    assets.list(
                            CUSTOM_PLUGIN_ASSET_DIR
                    );

        } catch (IOException ex) {

            Logger.e(
                    "Failed to list custom plugins",
                    ex
            );

            return;
        }

        if (files == null)
            return;

        for (String file : files) {

            if (!file.endsWith(".js"))
                continue;

            try (
                    var is =
                            assets.open(
                                    CUSTOM_PLUGIN_ASSET_DIR
                                            + "/"
                                            + file
                            )
            ) {

                CustomPluginScripts.add(
                        readAsText(is)
                );

            } catch (IOException ex) {

                Logger.e(
                        "Failed to read custom plugin: "
                                + file,
                        ex
                );
            }
        }
    }

    private static HttpURLConnection fetch(
            String url
    ) throws IOException {

        var conn =
                (HttpURLConnection)
                        new URL(url).openConnection();

        if (conn.getResponseCode() >= 300) {
            throw new HttpException(conn);
        }

        return conn;
    }

    private static String readAsText(
            InputStream is
    ) throws IOException {

        try (var baos =
                     new ByteArrayOutputStream()) {

            int n;

            byte[] buf =
                    new byte[16384];

            while ((n = is.read(buf)) > -1) {

                baos.write(
                        buf,
                        0,
                        n
                );
            }

            baos.flush();

            return baos.toString("UTF-8");
        }
    }
}
