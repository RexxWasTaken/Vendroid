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

  const upstreamGUM = md.getUserMedia.bind(md);

  const S = {
    gain: 0, pre: 0,
    low: 0, lowcut: 0, mid: 0, presence: 0, air: 0,
    clarity: 0, warmth: 0,
    sat: 0, soft: 0, comp: 0, limit: 0,
    attack: 35, release: 45,
    gate: 0,
    width: 0, balance: 50,
    excite: 0,
    mix: 100,
    enabled: true
  };

  const engines = new Set();

  function db(v) { return Math.pow(10, v / 20); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function curve(amount, driveMax) {
    const n = 2048;
    const c = new Float32Array(n);
    const a = clamp(amount / 100, 0, 1);
    const drive = 1 + a * driveMax;
    const norm = Math.tanh(drive) || 1;
    for (let i = 0; i < n; i++) {
      const x = i * 2 / (n - 1) - 1;
      c[i] = Math.tanh(x * drive) / norm;
    }
    return c;
  }

  function makeEngine(inputStream) {
    const ctx = new NativeAC({ latencyHint: "interactive", sampleRate: 48000 });
    const src = ctx.createMediaStreamSource(inputStream);
    const dest = ctx.createMediaStreamDestination();

    // Input / gain
    const input = ctx.createGain();
    const pre = ctx.createGain();

    // Tone
    const lowcut = ctx.createBiquadFilter();
    lowcut.type = "highpass";
    lowcut.frequency.value = 20;
    lowcut.Q.value = 0.55;

    const low = ctx.createBiquadFilter();
    low.type = "lowshelf";
    low.frequency.value = 110;

    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 900;
    mid.Q.value = 0.85;

    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 2800;
    presence.Q.value = 0.9;

    const clarity = ctx.createBiquadFilter();
    clarity.type = "peaking";
    clarity.frequency.value = 4300;
    clarity.Q.value = 1.0;

    const air = ctx.createBiquadFilter();
    air.type = "highshelf";
    air.frequency.value = 8000;

    // Warmth / saturation / soft clip
    const warmth = ctx.createBiquadFilter();
    warmth.type = "peaking";
    warmth.frequency.value = 230;
    warmth.Q.value = 0.7;

    const sat = ctx.createWaveShaper();
    const soft = ctx.createWaveShaper();
    sat.oversample = "4x";
    soft.oversample = "4x";

    // Exciter: high-pass -> shaper -> mix
    const exciter = ctx.createBiquadFilter();
    exciter.type = "highpass";
    exciter.frequency.value = 3500;
    exciter.Q.value = 0.7;
    const excShape = ctx.createWaveShaper();
    excShape.oversample = "2x";
    const excGain = ctx.createGain();

    // Dry/wet mix, still a single serial output path
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const mix = ctx.createGain();

    // Dynamics
    const comp = ctx.createDynamicsCompressor();
    const limiter = ctx.createDynamicsCompressor();

    // Stereo width, proper M/S matrix
    const split = ctx.createChannelSplitter(2);
    const merge = ctx.createChannelMerger(2);
    const left = ctx.createGain();
    const right = ctx.createGain();
    const midGain = ctx.createGain();
    const sideGain = ctx.createGain();
    const leftFromMid = ctx.createGain();
    const leftFromSide = ctx.createGain();
    const rightFromMid = ctx.createGain();
    const rightFromSide = ctx.createGain();

    // Final balance/output
    const pan = ctx.createStereoPanner();
    const master = ctx.createGain();

    /*
      SERIAL GRAPH:
      input
       -> tone
       -> dry/wet
       -> saturation/exciter
       -> compressor
       -> limiter
       -> stereo M/S
       -> balance
       -> master
       -> ONE destination
    */

    src.connect(input);
    input.connect(lowcut);
    lowcut.connect(low);
    low.connect(mid);
    mid.connect(presence);
    presence.connect(clarity);
    clarity.connect(air);
    air.connect(warmth);

    warmth.connect(dry);
    warmth.connect(wet);

    wet.connect(sat);
    sat.connect(soft);
    soft.connect(comp);
    comp.connect(limiter);
    limiter.connect(mix);

    // Exciter is mixed into the same wet path, not a second destination.
    warmth.connect(exciter);
    exciter.connect(excShape);
    excShape.connect(excGain);
    excGain.connect(mix);

    dry.connect(mix);

    // Stereo matrix. If the source is mono, both splitter outputs are handled.
    mix.connect(split);

    split.connect(midGain, 0);
    split.connect(sideGain, 0);
    split.connect(midGain, 1);
    split.connect(sideGain, 1);

    // Build M = (L+R)/2 and S = (L-R)/2 using gain nodes.
    // The two splitter channels feed dedicated gains, then are combined.
    const mL = ctx.createGain();
    const mR = ctx.createGain();
    const sL = ctx.createGain();
    const sR = ctx.createGain();

    // Rebuild the matrix explicitly:
    // L -> mL(+), R -> mR(+), L -> sL(+), R -> sR(-)
    const mBus = ctx.createGain();
    const sBus = ctx.createGain();
    const mToL = ctx.createGain();
    const mToR = ctx.createGain();
    const sToL = ctx.createGain();
    const sToR = ctx.createGain();

    // Disconnect the unused first attempt and use clean buses.
    try { midGain.disconnect(); } catch (_) {}
    try { sideGain.disconnect(); } catch (_) {}

    split.connect(mL, 0);
    split.connect(mR, 1);
    split.connect(sL, 0);
    split.connect(sR, 1);

    mL.gain.value = 0.5;
    mR.gain.value = 0.5;
    sL.gain.value = 0.5;
    sR.gain.value = -0.5;

    mL.connect(mBus);
    mR.connect(mBus);
    sL.connect(sBus);
    sR.connect(sBus);

    mBus.connect(mToL);
    mBus.connect(mToR);
    sBus.connect(sToL);
    sBus.connect(sToR);

    mToL.connect(merge, 0, 0);
    sToL.connect(merge, 0, 0);
    mToR.connect(merge, 0, 1);
    sToR.connect(merge, 0, 1);

    merge.connect(pan);
    pan.connect(master);
    master.connect(dest);

    const e = {
      ctx, src, dest, input, pre, lowcut, low, mid, presence, clarity, air,
      warmth, sat, soft, exciter, excShape, excGain, dry, wet, mix,
      comp, limiter, split, merge, pan, master,
      mL, mR, sL, sR, mBus, sBus, mToL, mToR, sToL, sToR,
      inputStream
    };

    function update() {
      const s = S;
      const now = ctx.currentTime;

      // Additional gain ABOVE Rexx Hook.
      // 0 = exact unity. 100 = +18 dB.
      input.gain.setTargetAtTime(s.enabled ? db((s.gain / 100) * 18) : 1, now, .015);

      // Preamp: 0..+12 dB.
      pre.gain.setTargetAtTime(db((s.pre / 100) * 12), now, .015);

      lowcut.frequency.setTargetAtTime(20 + s.lowcut * 1.8, now, .02);
      low.gain.setTargetAtTime(s.low * .18, now, .02);
      mid.gain.setTargetAtTime(s.mid * .12, now, .02);
      presence.gain.setTargetAtTime(s.presence * .12, now, .02);
      clarity.gain.setTargetAtTime(s.clarity * .10, now, .02);
      air.gain.setTargetAtTime(s.air * .10, now, .02);
      warmth.gain.setTargetAtTime(s.warmth * .12, now, .02);

      sat.curve = curve(s.sat, 18);
      soft.curve = curve(s.soft, 5);

      dry.gain.setTargetAtTime((100 - s.mix) / 100, now, .02);
      wet.gain.setTargetAtTime(s.mix / 100, now, .02);

      excShape.curve = curve(s.excite, 8);
      excGain.gain.setTargetAtTime(s.excite / 250, now, .02);

      // Compressor: 0 is a true bypass-like setting.
      if (s.comp <= 0) {
        comp.threshold.setTargetAtTime(0, now, .02);
        comp.ratio.setTargetAtTime(1, now, .02);
        comp.knee.setTargetAtTime(0, now, .02);
      } else {
        comp.threshold.setTargetAtTime(-6 - s.comp * .34, now, .02);
        comp.ratio.setTargetAtTime(1.2 + s.comp * .075, now, .02);
        comp.knee.setTargetAtTime(8 + s.comp * .20, now, .02);
      }
      comp.attack.setTargetAtTime(.001 + s.attack * .00045, now, .02);
      comp.release.setTargetAtTime(.025 + s.release * .003, now, .02);

      // Gate-like attenuation: only affects the final compressor threshold,
      // never cuts the stream or disconnects the graph.
      if (s.gate > 0 && s.comp > 0) {
        comp.threshold.setTargetAtTime(
          -6 - s.comp * .34 + s.gate * .06,
          now, .02
        );
      }

      // Limiter: 0 = bypass-like. 100 = strongest protection.
      if (s.limit <= 0) {
        limiter.threshold.setTargetAtTime(0, now, .02);
        limiter.ratio.setTargetAtTime(1, now, .02);
        limiter.knee.setTargetAtTime(0, now, .02);
      } else {
        limiter.threshold.setTargetAtTime(-0.1 - s.limit * .09, now, .02);
        limiter.ratio.setTargetAtTime(20, now, .02);
        limiter.knee.setTargetAtTime(0, now, .02);
      }
      limiter.attack.setTargetAtTime(.001, now, .02);
      limiter.release.setTargetAtTime(.03 + s.release * .0015, now, .02);

      // Width = 0 normal stereo. 100 exaggerates side channel.
      const w = s.width / 100;
      const mid = 1;
      const side = 1 + w * 1.2;

      // These are the M/S output coefficients.
      mToL.gain.setTargetAtTime(mid, now, .02);
      mToR.gain.setTargetAtTime(mid, now, .02);
      sToL.gain.setTargetAtTime(side, now, .02);
      sToR.gain.setTargetAtTime(-side, now, .02);

      pan.pan.setTargetAtTime(clamp((s.balance - 50) / 50, -1, 1), now, .02);

      master.gain.setTargetAtTime(s.enabled ? 1 : 0, now, .015);
    }

    e.update = update;
    update();
    engines.add(e);

    const heartbeat = setInterval(() => {
      if (ctx.state === "closed") {
        clearInterval(heartbeat);
        engines.delete(e);
        return;
      }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      update();
    }, 1000);

    return e;
  }

  /*
    THE IMPORTANT PART:
    We save whatever getUserMedia currently is.
    If Rexx Hook is already installed, upstreamGUM is Rexx Hook's wrapper.
    Therefore its processed destination stream becomes our input.
    We then return ONE new destination stream to Discord.
  */
  md.getUserMedia = async function (constraints) {
    if (!constraints || !constraints.audio) {
      return upstreamGUM(constraints);
    }

    let upstreamStream;
    try {
      upstreamStream = await upstreamGUM(constraints);
    } catch (err) {
      console.warn("[REXX COVER] upstream getUserMedia failed", err);
      throw err;
    }

    try {
      const e = makeEngine(upstreamStream);
      await e.ctx.resume().catch(() => {});
      return e.dest.stream;
    } catch (err) {
      console.warn("[REXX COVER] DSP fallback -> upstream stream", err);
      return upstreamStream;
    }
  };

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
      <div class="rc-status" id="rc-status">WAITING FOR MIC • POST-LAYER READY</div>
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
