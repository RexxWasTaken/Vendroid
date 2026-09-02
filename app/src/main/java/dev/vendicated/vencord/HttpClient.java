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
                        var es = conn.getErrorStream()
                ) {

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
                            "Error while building message. Url is "
                                    + conn.getURL().toString();
                }
            }

            return message;
        }
    }

    /*
     * COMPLETE Vencord browser.js bundle.
     *
     * The downloaded JavaScript is kept in RAM.
     * It is NOT written to a local .js file.
     */
    public static String VencordRuntime;

    /*
     * Existing Vendroid mobile glue runtime.
     */
    public static String VencordMobileRuntime;

    /*
     * Existing desktop detection/scaling runtime.
     */
    public static String VendroidDesktopRuntime;

    /*
     * Locally bundled custom plugins.
     */
    public static final List<String>
            CustomPluginScripts =
            new ArrayList<>();

    private static final String
            CUSTOM_PLUGIN_ASSET_DIR =
            "vencord/custom";

    public static void fetchVencord(
            Activity activity
    ) throws IOException {

        /*
         * Don't download the same bundle twice.
         */
        if (VencordRuntime != null) {
            return;
        }

        var res =
                activity.getResources();

        /*
         * Load the existing mobile runtime.
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
         * Load the existing desktop runtime.
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
         * Load local custom plugins.
         *
         * This does NOT modify Vencord's own bundle.
         */
        loadCustomPlugins(activity);

        /*
         * Download the COMPLETE official Vencord browser bundle.
         *
         * URL:
         *
         * https://github.com/Vendicated/Vencord/releases/download/devbuild/browser.js
         *
         * The response is stored directly in VencordRuntime.
         * Nothing is saved to disk.
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
