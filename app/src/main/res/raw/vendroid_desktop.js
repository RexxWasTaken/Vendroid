/*
 * Vendroid desktop mode.
 *
 * 1. Desktop browser detection
 * 2. Desktop Discord UI ko 60% scale
 */

!(() => {

    if (window.__VENDROID_DESKTOP__)
        return;

    window.__VENDROID_DESKTOP__ = true;

    // Desktop navigator hints

    try {

        Object.defineProperty(
            navigator,
            "maxTouchPoints",
            {
                get: function () {
                    return 0;
                },
                configurable: true
            }
        );

    } catch (e) {}

    try {

        Object.defineProperty(
            navigator,
            "platform",
            {
                get: function () {
                    return "Win32";
                },
                configurable: true
            }
        );

    } catch (e) {}

    // Desktop UI scale

    var ZOOM = "0.6";

    var STYLE_ID =
            "vendroid-desktop-zoom";

    function ensureStyle() {

        var root =
                document.head
                || document.documentElement;

        if (!root)
            return;

        var style =
                document.getElementById(
                        STYLE_ID
                );

        if (!style) {

            style =
                    document.createElement(
                            "style"
                    );

            style.id = STYLE_ID;

            root.appendChild(style);
        }

        style.textContent =
                "html{zoom:"
                + ZOOM
                + " !important;}";
    }

    ensureStyle();

    document.addEventListener(
            "DOMContentLoaded",
            ensureStyle,
            { once: true }
    );

    // Watchdog
    new MutationObserver(
            function () {

                if (
                    !document.getElementById(
                            STYLE_ID
                    )
                ) {

                    ensureStyle();
                }
            }
    ).observe(
            document.documentElement,
            {
                childList: true
            }
    );

})();
