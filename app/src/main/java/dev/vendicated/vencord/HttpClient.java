package dev.vendicated.vencord;

import android.app.Activity;

import androidx.annotation.NonNull;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class HttpClient {

    public static final class HttpException
            extends IOException {

        private final HttpURLConnection conn;

        private String message;

        public HttpException(
                HttpURLConnection conn
        ) {
            this.conn = conn;
        }

        @Override
        @NonNull
        public String getMessage() {

            if (message == null) {

                try (
                        var es =
                                conn.getErrorStream()
                ) {

                    message =
                            String.format(
                                    Locale.ENGLISH,
                                    "%d: %s (%s)\n%s",
                                    conn.getResponseCode(),
                                    conn.getResponseMessage(),
                                    conn.getURL()
                                            .toString(),
                                    readAsText(es)
                            );

                } catch (IOException ex) {

                    message =
                            "Error while building message. Url is "
                                    + conn.getURL()
                                    .toString();
                }
            }

            return message;
        }
    }

    public static String VencordRuntime;

    public static String VencordMobileRuntime;

    public static String VendroidDesktopRuntime;

    /*
     * ALL bundled custom plugins.
     *
     * Example:
     *
     * app/src/main/assets/vencord/custom/
     *     StereoLoudMic.js
     *     Plugin2.js
     *     Plugin3.js
     */
    public static final List<String>
            CustomPluginScripts =
            new ArrayList<>();

    /*
     * IMPORTANT:
     *
     * This directory must NOT be changed.
     */
    private static final String
            CUSTOM_PLUGIN_ASSET_DIR =
            "vencord/custom";

    public static void fetchVencord(
            Activity activity
    ) throws IOException {

        /*
         * Already loaded.
         */
        if (VencordRuntime != null) {
            return;
        }

        var res =
                activity.getResources();

        /*
         * Vendroid mobile runtime.
         */
        try (
                var is =
                        res.openRawResource(
                                R.raw.vencord_mobile
                        )
        ) {

            VencordMobileRuntime =
                    readAsText(is);
        }

        /*
         * Desktop detection / scaling.
         */
        try (
                var is =
                        res.openRawResource(
                                R.raw.vendroid_desktop
                        )
        ) {

            VendroidDesktopRuntime =
                    readAsText(is);
        }

        /*
         * LOAD EVERY LOCAL CUSTOM PLUGIN.
         *
         * This happens before the remote Vencord bundle is
         * downloaded, but the actual JavaScript execution happens
         * later in VWebviewClient AFTER Vencord is initialized.
         */
        loadCustomPlugins(activity);

        /*
         * Download/load the normal Vencord browser bundle.
         */
        var conn =
                fetch(
                        Constants.JS_BUNDLE_URL
                );

        try (
                var is =
                        conn.getInputStream()
        ) {

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

        if (files == null) {
            Logger.w(
                    "No custom plugin directory found: "
                            + CUSTOM_PLUGIN_ASSET_DIR
            );

            return;
        }

        for (String file : files) {

            /*
             * Only JS files.
             */
            if (
                    file == null
                            || !file.toLowerCase(
                            Locale.ENGLISH
                    ).endsWith(".js")
            ) {
                continue;
            }

            String assetPath =
                    CUSTOM_PLUGIN_ASSET_DIR
                            + "/"
                            + file;

            try (
                    var is =
                            assets.open(
                                    assetPath
                            )
            ) {

                String script =
                        readAsText(is);

                if (
                        script != null
                                && !script.trim()
                                .isEmpty()
                ) {

                    CustomPluginScripts.add(
                            script
                    );

                    Logger.i(
                            "Loaded custom plugin: "
                                    + file
                    );
                }

            } catch (IOException ex) {

                /*
                 * One broken plugin must NOT stop the
                 * remaining plugins.
                 */
                Logger.e(
                        "Failed to read custom plugin: "
                                + file,
                        ex
                );
            }
        }

        Logger.i(
                "Custom plugins loaded: "
                        + CustomPluginScripts.size()
        );
    }

    private static HttpURLConnection fetch(
            String url
    ) throws IOException {

        var conn =
                (HttpURLConnection)
                        new URL(url)
                                .openConnection();

        if (
                conn.getResponseCode()
                        >= 300
        ) {

            throw new HttpException(
                    conn
            );
        }

        return conn;
    }

    private static String readAsText(
            InputStream is
    ) throws IOException {

        if (is == null) {
            return "";
        }

        try (
                var baos =
                        new ByteArrayOutputStream()
        ) {

            int n;

            byte[] buffer =
                    new byte[16384];

            while (
                    (n = is.read(buffer))
                            > -1
            ) {

                baos.write(
                        buffer,
                        0,
                        n
                );
            }

            baos.flush();

            return baos.toString(
                    "UTF-8"
            );
        }
    }
}
