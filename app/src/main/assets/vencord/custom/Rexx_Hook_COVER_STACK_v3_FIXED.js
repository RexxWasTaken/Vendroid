/*
 REXX HOOK COVER / STACK LAYER v2
 --------------------------------
 Purpose:
   - This file is an ADDITIONAL layer, not a replacement for Rexx Hook.
   - Install AFTER the original Rexx Hook.
   - Call order becomes:
       Mic -> Rexx Hook -> REXX COVER -> Discord
   - If original Rexx Hook is absent, this still works:
       Mic -> REXX COVER -> Discord

 IMPORTANT:
   - No __RHv6 guard.
   - No second RTCPeerConnection patch.
   - No fake mute/deafen patch.
   - No worklet named rh-engine-v6.
   - Only one serial destination is returned to Discord.
   - It wraps the currently installed getUserMedia, so when Rexx Hook
     is already installed its processed stream becomes our INPUT.
*/

(() => {
  "use strict";

  if (window.__REXX_COVER_V2__) return;
  window.__REXX_COVER_V2__ = true;

  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;

  const NativeAC = window.AudioContext || window.webkitAudioContext;
  if (!NativeAC) return;

  /*
    STACK INSTALLER
    ---------------
    Rexx v6 replaces navigator.mediaDevices.getUserMedia itself. If this
    addon installs first, v6 can overwrite us. Therefore we keep a tiny
    installer watcher and wrap whatever function is currently upstream.

    We never call ourselves recursively:
      native -> v6 -> COVER
    or:
      native -> COVER
    depending on load order.
  */
  const COVER_TAG = "__REXX_COVER_WRAPPER_V2__";
  let lastUpstream = null;

  function installWrapper() {
    const current = md.getUserMedia;
    if (typeof current !== "function") return;
    if (current[COVER_TAG]) return;

    const upstream = current.bind(md);

    async function coverGetUserMedia(constraints) {
      if (!constraints || !constraints.audio) {
        return upstream(constraints);
      }

      let upstreamStream;
      try {
        // This is the critical hand-off:
        // if Rexx Hook v6 is already installed, its processed stream arrives here.
        upstreamStream = await upstream(constraints);
      } catch (err) {
        console.warn("[REXX COVER] upstream GUM failed", err);
        throw err;
      }

      try {
        const e = makeEngine(upstreamStream);
        await e.ctx.resume().catch(() => {});
        return e.dest.stream;
      } catch (err) {
        // Never turn a working Rexx Hook mic into Error 3002.
        console.warn("[REXX COVER] post layer failed; keeping upstream stream", err);
        return upstreamStream;
      }
    }

    Object.defineProperty(coverGetUserMedia, COVER_TAG, {value:true});
    Object.defineProperty(coverGetUserMedia, "__REXX_COVER_UPSTREAM__", {value:current});

    try {
      md.getUserMedia = coverGetUserMedia;
    } catch (_) {
      try { Object.defineProperty(md, "getUserMedia", {
        value:coverGetUserMedia, configurable:true, writable:true
      }); } catch (__) {}
    }

    lastUpstream = current;
    console.log("[REXX COVER v3] wrapped current GUM");
  }

  // Install now and again after v6/browser injection.
  installWrapper();

  let hookChecks = 0;
  const hookWatcher = setInterval(() => {
    const current = md.getUserMedia;

    // If v6 (or another legitimate hook) replaced our wrapper, wrap it.
    if (current && !current[COVER_TAG] && current !== lastUpstream) {
      installWrapper();
    }

    // Also retry during the initial Discord startup window.
    if (++hookChecks > 120) clearInterval(hookWatcher);
  }, 100);

  // One later pass catches scripts injected after the initial 12s window.
  setTimeout(installWrapper, 1500);
  setTimeout(installWrapper, 3000);

  // ---------- UI ----------
  const CSS = `
#rxcover-fab{
 position:fixed!important;left:18px!important;bottom:18px!important;
 width:50px!important;height:50px!important;border-radius:50%!important;
 border:1px solid rgba(255,255,255,.16)!important;
 background:#10121a!important;color:#fff!important;
 z-index:2147483647!important;cursor:pointer!important;
 font:700 22px Arial!important;
 box-shadow:0 8px 30px #0009!important;
}
#rxcover{
 position:fixed!important;left:18px!important;bottom:78px!important;
 width:335px!important;max-height:78vh!important;overflow:auto!important;
 padding:13px!important;border-radius:15px!important;
 background:rgba(10,12,18,.98)!important;color:#eee!important;
 border:1px solid #292d38!important;z-index:2147483646!important;
 box-shadow:0 18px 60px #000b!important;
 font:12px system-ui,Arial!important;backdrop-filter:blur(16px)!important;
}
#rxcover *{box-sizing:border-box}
.rc-head{display:flex;justify-content:space-between;align-items:center}
.rc-title{font-weight:900;font-size:15px}
.rc-badge{font-size:9px;color:#a78bfa;background:#181522;padding:4px 7px;border-radius:7px}
.rc-sub{font-size:10px;color:#8f95a3;margin:5px 0 12px}
.rc-row{margin:8px 0}
.rc-line{display:flex;justify-content:space-between;margin-bottom:4px}
.rc-name{font-weight:700}.rc-val{color:#a78bfa}
.rc-row input{width:100%;accent-color:#8b5cf6}
.rc-buttons{display:flex;gap:7px;margin-top:10px}
.rc-btn{flex:1;border:1px solid #303442;background:#171923;color:#eee;border-radius:9px;padding:8px;font-weight:800}
.rc-status{margin-top:8px;padding:8px;border-radius:8px;background:#11131a;color:#9ca3af}
`;

  function addUI() {
    if (!document.body || document.getElementById("rxcover-fab")) {
      if (!document.getElementById("rxcover-fab")) setTimeout(addUI, 300);
      return;
    }

    const st = document.createElement("style");
    st.id = "rxcover-style";
    st.textContent = CSS;
    document.head.appendChild(st);

    const fab = document.createElement("button");
    fab.id = "rxcover-fab";
    fab.textContent = "⚡";
    fab.title = "Rexx Hook Cover";
    document.body.appendChild(fab);

    const box = document.createElement("div");
    box.id = "rxcover";
    box.style.display = "none";

    const defs = [
      ["gain","Ultra Gain"],["pre","Preamp"],["low","Low Boost"],["lowcut","Low Cut"],
      ["mid","Mid Boost"],["presence","Presence"],["air","Air"],["clarity","Clarity"],
      ["warmth","Warmth"],["sat","Saturation"],["soft","Soft Clip"],
      ["comp","Compressor"],["limit","Limiter"],["attack","Attack"],["release","Release"],
      ["gate","Gate"],["width","Stereo Width"],["balance","Balance"],
      ["excite","Exciter"],["mix","Output Mix"]
    ];

    box.innerHTML = `
      <div class="rc-head">
        <div class="rc-title">REXX HOOK COVER</div>
        <div class="rc-badge">STACK • POST</div>
      </div>
      <div class="rc-sub">Rexx Hook stays ON → this layer adds processing above it</div>
      <div id="rc-controls"></div>
      <div class="rc-buttons">
        <button class="rc-btn" id="rc-on">ON</button>
        <button class="rc-btn" id="rc-reset">RESET</button>
      </div>
      <div class="rc-status" id="rc-status">POST-LAYER READY • waiting for mic</div>
    `;

    document.body.appendChild(box);
    const controls = box.querySelector("#rc-controls");

    defs.forEach(([key,label]) => {
      let value = S[key];
      const row = document.createElement("div");
      row.className = "rc-row";
      row.innerHTML = `
        <div class="rc-line"><span class="rc-name">${label}</span>
        <span class="rc-val">${value}%</span></div>
        <input type="range" min="0" max="100" step="1" value="${value}">
      `;
      const input = row.querySelector("input");
      const val = row.querySelector(".rc-val");
      input.oninput = () => {
        S[key] = Number(input.value);
        val.textContent = input.value + "%";
        engines.forEach(e => e.update());
        box.querySelector("#rc-status").textContent = "POST-LAYER • ACTIVE";
      };
      controls.appendChild(row);
    });

    fab.onclick = () => {
      box.style.display = box.style.display === "none" ? "block" : "none";
    };

    box.querySelector("#rc-on").onclick = () => {
      S.enabled = !S.enabled;
      box.querySelector("#rc-on").textContent = S.enabled ? "ON" : "BYPASS";
      box.querySelector("#rc-status").textContent =
        S.enabled ? "POST-LAYER • ACTIVE" : "POST-LAYER • BYPASS";
      engines.forEach(e => e.update());
    };

    box.querySelector("#rc-reset").onclick = () => {
      Object.assign(S, {
        gain:0,pre:0,low:0,lowcut:0,mid:0,presence:0,air:0,
        clarity:0,warmth:0,sat:0,soft:0,comp:0,limit:0,
        attack:35,release:45,gate:0,width:0,balance:50,excite:0,mix:100,
        enabled:true
      });
      const inputs = controls.querySelectorAll("input");
      defs.forEach(([key],i) => {
        inputs[i].value = S[key];
        inputs[i].parentElement.querySelector(".rc-val").textContent = S[key] + "%";
      });
      box.querySelector("#rc-on").textContent = "ON";
      box.querySelector("#rc-status").textContent = "POST-LAYER • RESET";
      engines.forEach(e => e.update());
    };
  }

  addUI();

  // Re-add only the UI if Discord rerenders its document.
  let tries = 0;
  const uiRetry = setInterval(() => {
    if (document.getElementById("rxcover-fab")) {
      clearInterval(uiRetry);
      return;
    }
    addUI();
    if (++tries > 40) clearInterval(uiRetry);
  }, 500);

  console.log("[REXX COVER v2] loaded — serial post-layer, stack-safe");
})();
