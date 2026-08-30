package dev.vendicated.vencord;

import android.content.Intent;
import android.graphics.Bitmap;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.Nullable;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;

public class VWebviewClient extends WebViewClient {

    @Override
    public boolean shouldOverrideUrlLoading(
            WebView view,
            WebResourceRequest request
    ) {

        var url =
                request.getUrl();

        if (
                "discord.com".equals(
                        url.getAuthority()
                )
                        || "about:blank".equals(
                        url.toString()
                )
        ) {

            return false;
        }

        Intent intent =
                new Intent(
                        Intent.ACTION_VIEW,
                        url
                );

        view.getContext().startActivity(
                intent
        );

        return true;
    }

    @Override
    public void onPageStarted(
            WebView view,
            String url,
            Bitmap favicon
    ) {

        /*
         * IMPORTANT:
         *
         * Desktop detection has to be injected first.
         */
        if (
                HttpClient.VendroidDesktopRuntime
                        != null
        ) {

            view.evaluateJavascript(
                    HttpClient.VendroidDesktopRuntime,
                    null
            );
        }

        super.onPageStarted(
                view,
                url,
                favicon
        );
    }

    @Override
    public void onPageFinished(
            WebView view,
            String url
    ) {

        /*
         * Wait until Discord's document is actually loaded.
         *
         * Then load in strict order:
         *
         * 1. Vencord
         * 2. Vendroid mobile runtime
         * 3. EVERY custom plugin
         */
        loadVencordChain(view);

        view.setVisibility(
                View.VISIBLE
        );

        super.onPageFinished(
                view,
                url
        );
    }

    private void loadVencordChain(
            WebView view
    ) {

        /*
         * STEP 1
         * Vencord main runtime
         */
        if (
                HttpClient.VencordRuntime
                        == null
        ) {

            Logger.e(
                    "VencordRuntime is null"
            );

            return;
        }

        view.evaluateJavascript(
                HttpClient.VencordRuntime,
                result -> {

                    /*
                     * STEP 2
                     * Existing Vendroid/Vencord mobile runtime.
                     */
                    if (
                            HttpClient.VencordMobileRuntime
                                    != null
                    ) {

                        view.evaluateJavascript(
                                HttpClient.VencordMobileRuntime,
                                mobileResult ->
                                        loadCustomPlugins(view)
                        );

                    } else {

                        loadCustomPlugins(view);
                    }
                }
        );
    }

    private void loadCustomPlugins(
            WebView view
    ) {

        /*
         * Every custom plugin is executed independently.
         *
         * If StereoLoudMic crashes, another plugin still gets
         * its chance to load.
         */
        for (
                String script :
                HttpClient.CustomPluginScripts
        ) {

            String wrapped =
                    "(function(){"
                            + "try{"
                            + script
                            + "}catch(e){"
                            + "console.error("
                            + "'[Vendroid custom plugin error]',"
                            + "e"
                            + ");"
                            + "}"
                            + "})();";

            view.evaluateJavascript(
                    wrapped,
                    null
            );
        }
    }

    @Nullable
    @Override
    public WebResourceResponse shouldInterceptRequest(
            WebView view,
            WebResourceRequest req
    ) {

        var uri =
                req.getUrl();

        String path =
                uri.getPath();

        if (
                req.isForMainFrame()
                        || (
                        path != null
                                && path.endsWith(
                                ".css"
                        )
                )
        ) {

            try {

                return doFetch(req);

            } catch (IOException ex) {

                Logger.e(
                        "Error during shouldInterceptRequest",
                        ex
                );
            }
        }

        return null;
    }

    private WebResourceResponse doFetch(
            WebResourceRequest req
    ) throws IOException {

        var url =
                req.getUrl()
                        .toString();

        var conn =
                (HttpURLConnection)
                        new URL(url)
                                .openConnection();

        conn.setRequestMethod(
                req.getMethod()
        );

        for (
                var header :
                req.getRequestHeaders()
                        .entrySet()
        ) {

            conn.setRequestProperty(
                    header.getKey(),
                    header.getValue()
            );
        }

        var code =
                conn.getResponseCode();

        var msg =
                conn.getResponseMessage();

        var headers =
                conn.getHeaderFields();

        var modifiedHeaders =
                new HashMap<String, String>(
                        headers.size()
                );

        for (
                var header :
                headers.entrySet()
        ) {

            if (
                    !"Content-Security-Policy"
                            .equalsIgnoreCase(
                                    header.getKey()
                            )
                    && header.getKey() != null
                    && header.getValue() != null
                    && !header.getValue().isEmpty()
            ) {

                modifiedHeaders.put(
                        header.getKey(),
                        header.getValue().get(0)
                );
            }
        }

        if (url.endsWith(".css")) {

            modifiedHeaders.put(
                    "Content-Type",
                    "text/css"
            );
        }

        String contentType =
                modifiedHeaders.getOrDefault(
                        "Content-Type",
                        "application/octet-stream"
                );

        return new WebResourceResponse(
                contentType,
                "utf-8",
                code,
                msg,
                modifiedHeaders,
                conn.getInputStream()
        );
    }
}
