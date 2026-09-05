/*
 REXX COVER — POST-DSP LAYER v4 (FIXED / REAL DSP)
 --------------------------------------------------
 Purpose:
   - Runs strictly AFTER REXX HOOK v6 (window.__RHv6 / hook.js).
   - Never replaces, disables, or reloads Rexx Hook.
   - Wraps whatever getUserMedia is CURRENTLY installed, so:

       Mic -> REXX HOOK v6 -> REXX HOOK max/high gain -> REXX COVER -> Discord

     and, if some other post layer (e.g. "Rexx Ultra") is chained in
     front of us too:

       Mic -> REXX HOOK -> REXX ULTRA -> REXX COVER -> Discord

     If Rexx Hook is absent entirely, this file still works standalone:

       Mic -> REXX COVER -> Discord

 v4 FIX NOTES (this build):
   - v3 shipped with a broken UI: it referenced a state object `S`,
     `makeEngine()` and an `engines` array that were never defined
     anywhere in the file. The ⚡ button rendered but did nothing,
     and no audio DSP ever ran. This build defines all of it and
     wires up a real Web Audio graph, so every slider changes actual
     audio in real time.
   - No __RHv6 guard reused. No second RTCPeerConnection patch.
     No AudioWorklet named rh-engine-v6. Only one serial destination
     stream is ever handed back to Discord.
   - All gain math is clamped/finite-checked. No NaN/Infinity can
     reach an AudioParam. If the DSP graph fails to build for any
     reason, Cover bypasses itself and hands the untouched upstream
     (Rexx Hook) stream straight to Discord — mic never dies, no
     Error 3002.
*/

(() => {
  "use strict";

  if (window.__REXX_COVER_V2__) return;
  window.__REXX_COVER_V2__ = true;

  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;

  const NativeAC = window.AudioContext || window.webkitAudioContext;
  if (!NativeAC) return;

  /* ============================================================
     SAFE MATH HELPERS — never let NaN/Infinity touch an AudioParam
     ============================================================ */
  function num(v, fallback) {
    return (typeof v === "number" && isFinite(v)) ? v : fallback;
  }
  function clamp(v, lo, hi) {
    v = num(v, lo);
    return Math.min(hi, Math.max(lo, v));
  }
  function pct(v) {
    // slider values come in as 0..100
    return clamp(v, 0, 100) / 100;
  }
  function dbToGain(db) {
    db = clamp(db, -60, 40);
    return Math.pow(10, db / 20);
  }
  function safeSetTarget(param, value, ctx, tc) {
    try {
      value = num(value, param.value);
      const now = ctx.currentTime;
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, tc || 0.015);
    } catch (_) {
      try { param.value = num(value, param.value); } catch (__) {}
    }
  }
  function safeSetValue(param, value) {
    try {
      param.value = num(value, param.value);
    } catch (_) {}
  }

  /* ============================================================
     STATE — single source of truth for every slider
     ============================================================ */
  const DEFAULTS = {
    gain: 0,      // Ultra Gain
    pre: 0,       // Preamp
    low: 0,       // Low Boost
    lowcut: 0,    // Low Cut
    mid: 0,       // Mid Boost
    presence: 0,  // Presence
    air: 0,       // Air
    clarity: 0,   // Clarity
    warmth: 0,    // Warmth
    sat: 0,       // Saturation
    soft: 0,      // Soft Clip
    comp: 0,      // Compressor
    attack: 35,   // Attack
    release: 45,  // Release
    limit: 0,     // Limiter
    gate: 0,      // Gate
    width: 0,     // Stereo Width
    balance: 50,  // Balance (50 = center)
    excite: 0,    // Exciter
    mix: 100,     // Output Mix (100 = fully processed)
    enabled: true
  };

  const S = Object.assign({}, DEFAULTS);

  /* ============================================================
     WAVESHAPER CURVES
     ============================================================ */
  function driveCurve(amount) {
    // classic soft-saturation curve, amount 0..1
    const k = clamp(amount, 0, 1) * 45;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }
  function warmthCurve(amount) {
    // adds even-harmonic (asymmetric) coloration for a "warm" tube feel
    const a = clamp(amount, 0, 1) * 0.6;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      let y = x + a * x * Math.abs(x) * 0.6;
      y = Math.tanh(y * (1 + a));
      curve[i] = y;
    }
    return curve;
  }
  function softClipCurve(amount) {
    // gentle knee, rounds off peaks rather than hard-driving them
    const a = clamp(amount, 0, 1);
    const drive = 1 + a * 3;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  }
  function exciterCurve() {
    // fixed harder harmonic generator used only on the exciter send
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * 6);
    }
    return curve;
  }
  function safetyCurve() {
    // fixed final ceiling: always on, not user-controlled.
    // Keeps signal inside [-1,1] smoothly so extreme Ultra Gain / Preamp
    // settings cannot produce raw digital overs, dropouts, or a dead track.
    const n = 2048;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
    }
    return curve;
  }

  /* ============================================================
     ENGINE — builds the real audio graph for one stream
     ============================================================ */
  const engines = [];

  function makeEngine(inputStream) {
    /* CONTEXT SHARING (root fix for voice breaking/cutting):
       Previously Cover always did `new NativeAC()`, spinning up a SECOND,
       fully independent AudioContext while Rexx Hook's own AudioContext
       (window.DiscordContext) was already running. Two live AudioContexts
       fighting for the same Android audio hardware pipeline is a well
       known cause of exactly the symptom reported: voice breaking/cutting
       immediately on VC join, even at default settings, unrelated to any
       single slider.
       Fix: reuse Hook's existing, already-running context whenever it's
       available and open. Only fall back to creating a new context if
       Hook's context truly isn't available (e.g. Cover running standalone
       without Hook). */
    const __prevDiscordCtx = window.DiscordContext;
    let ctx;
    let __weCreatedNewCtx = false;
    if (__prevDiscordCtx && __prevDiscordCtx.state !== "closed") {
      ctx = __prevDiscordCtx;
    } else {
      ctx = new NativeAC();
      __weCreatedNewCtx = true;
    }
    // If creating our own context caused Hook's global patch to overwrite
    // window.DiscordContext, restore it (Hook reads it repeatedly for its
    // own meters/monitor/mp3/EQ features).
    if (__weCreatedNewCtx && window.DiscordContext === ctx && __prevDiscordCtx !== ctx) {
      window.DiscordContext = __prevDiscordCtx;
    }

    const source = ctx.createMediaStreamSource(inputStream);
    const dest = ctx.createMediaStreamDestination();

    // ---- dry tap (for Output Mix) ----
    const dryGain = ctx.createGain();
    dryGain.gain.value = 0;

    // ---- input stage ----
    const preampGain = ctx.createGain();
    preampGain.gain.value = 1;

    // gate: envelope-following gain reducer
    const gateAnalyser = ctx.createAnalyser();
    gateAnalyser.fftSize = 512;
    gateAnalyser.smoothingTimeConstant = 0;
    const gateBuf = new Float32Array(gateAnalyser.fftSize);
    const gateGain = ctx.createGain();
    gateGain.gain.value = 1;

    // ---- tone stack ----
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = "highpass";
    lowCut.frequency.value = 20;
    lowCut.Q.value = 0.7;

    const lowShelf = ctx.createBiquadFilter();
    lowShelf.type = "lowshelf";
    lowShelf.frequency.value = 150;

    const midPeak = ctx.createBiquadFilter();
    midPeak.type = "peaking";
    midPeak.frequency.value = 900;
    midPeak.Q.value = 1.0;

    const presencePeak = ctx.createBiquadFilter();
    presencePeak.type = "peaking";
    presencePeak.frequency.value = 3200;
    presencePeak.Q.value = 1.1;

    const airShelf = ctx.createBiquadFilter();
    airShelf.type = "highshelf";
    airShelf.frequency.value = 11000;

    const clarityPeak = ctx.createBiquadFilter();
    clarityPeak.type = "peaking";
    clarityPeak.frequency.value = 6000;
    clarityPeak.Q.value = 1.0;

    const warmthShelf = ctx.createBiquadFilter();
    warmthShelf.type = "lowshelf";
    warmthShelf.frequency.value = 300;

    // ---- exciter send/return ----
    const exciterHPF = ctx.createBiquadFilter();
    exciterHPF.type = "highpass";
    exciterHPF.frequency.value = 2500;
    const exciterShaper = ctx.createWaveShaper();
    exciterShaper.curve = exciterCurve();
    exciterShaper.oversample = "2x";
    const exciterWetGain = ctx.createGain();
    exciterWetGain.gain.value = 0;
    const exciterSum = ctx.createGain();
    exciterSum.gain.value = 1;

    // ---- harmonic / drive stage ----
    const warmthShaper = ctx.createWaveShaper();
    warmthShaper.curve = warmthCurve(0);
    warmthShaper.oversample = "2x";

    const satShaper = ctx.createWaveShaper();
    satShaper.curve = driveCurve(0);
    satShaper.oversample = "2x";

    const softClipShaper = ctx.createWaveShaper();
    softClipShaper.curve = softClipCurve(0);
    softClipShaper.oversample = "2x";

    // ---- output loudness stage ----
    const ultraGain = ctx.createGain();
    ultraGain.gain.value = 1;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = 0;
    compressor.knee.value = 6;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.02;
    compressor.release.value = 0.15;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -0.3;
    limiter.knee.value = 0;
    limiter.ratio.value = 1;   // 1 = transparent until update() runs; was hardcoded 20 (bug)
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;

    const safetyShaper = ctx.createWaveShaper();
    safetyShaper.curve = safetyCurve();
    safetyShaper.oversample = "2x";

    // ---- stereo width (Haas-style decorrelation, mono-safe) ----
    const leftGain = ctx.createGain();
    leftGain.gain.value = 1;
    const widenDelay = ctx.createDelay(0.05);
    widenDelay.delayTime.value = 0;
    const rightGain = ctx.createGain();
    rightGain.gain.value = 1;
    const merger = ctx.createChannelMerger(2);

    const panner = ctx.createStereoPanner
      ? ctx.createStereoPanner()
      : null;

    const wetGain = ctx.createGain();
    wetGain.gain.value = 1;

    const mixSum = ctx.createGain();
    mixSum.gain.value = 1;

    // =========== WIRE THE GRAPH ===========
    // dry path (Output Mix)
    source.connect(dryGain);
    dryGain.connect(mixSum);

    // wet path
    source.connect(preampGain);

    preampGain.connect(gateAnalyser); // parallel tap, does not continue chain
    preampGain.connect(gateGain);

    gateGain.connect(lowCut);
    lowCut.connect(lowShelf);
    lowShelf.connect(midPeak);
    midPeak.connect(presencePeak);
    presencePeak.connect(airShelf);
    airShelf.connect(clarityPeak);
    clarityPeak.connect(warmthShelf);

    // exciter dry/wet sum
    warmthShelf.connect(exciterSum);       // dry
    warmthShelf.connect(exciterHPF);       // wet send
    exciterHPF.connect(exciterShaper);
    exciterShaper.connect(exciterWetGain);
    exciterWetGain.connect(exciterSum);

    exciterSum.connect(warmthShaper);
    warmthShaper.connect(satShaper);
    satShaper.connect(softClipShaper);
    const dynOut = ctx.createGain();
    dynOut.gain.value = 1;
    softClipShaper.connect(ultraGain);

    let dynProcessed = false; // starts bypassed since comp=0, limit=0 by default
    function setDynamicsBypass(shouldProcess) {
      if (shouldProcess === dynProcessed) return;
      try {
        if (shouldProcess) {
          ultraGain.disconnect(dynOut);
          ultraGain.connect(compressor);
          compressor.connect(limiter);
          limiter.connect(dynOut);
        } else {
          try { ultraGain.disconnect(compressor); } catch (_) {}
          try { compressor.disconnect(limiter); } catch (_) {}
          try { limiter.disconnect(dynOut); } catch (_) {}
          ultraGain.connect(dynOut);
        }
      } catch (_) {}
      dynProcessed = shouldProcess;
    }
    // start bypassed: direct passthrough, zero DynamicsCompressorNode CPU cost
    ultraGain.connect(dynOut);
    dynOut.connect(safetyShaper);

    // stereo widener (mono-safe: width 0 => L===R, fully transparent)
    safetyShaper.connect(leftGain);
    safetyShaper.connect(widenDelay);
    widenDelay.connect(rightGain);
    leftGain.connect(merger, 0, 0);
    rightGain.connect(merger, 0, 1);

    let tail = merger;
    if (panner) {
      merger.connect(panner);
      panner.connect(wetGain);
    } else {
      merger.connect(wetGain);
    }

    wetGain.connect(mixSum);
    mixSum.connect(dest);

    /* ============================================================
       PARAMETER UPDATE — called on every slider change AND on init
       ============================================================ */
    function update() {
      if (!S.enabled) {
        // full bypass: dry only, wet muted
        safeSetTarget(dryGain.gain, 1, ctx);
        safeSetTarget(wetGain.gain, 0, ctx);
        return;
      }

      // Preamp: extra input drive, 0..+18dB
      safeSetTarget(preampGain.gain, dbToGain(pct(S.pre) * 18), ctx);

      // Low Cut: 20Hz (off) up to 300Hz (aggressive)
      safeSetTarget(lowCut.frequency, 20 + pct(S.lowcut) * 280, ctx);

      // Low Boost: shelf gain 0..+12dB
      safeSetTarget(lowShelf.gain, pct(S.low) * 12, ctx);

      // Mid Boost: peak 0..+9dB
      safeSetTarget(midPeak.gain, pct(S.mid) * 9, ctx);

      // Presence: peak 0..+9dB
      safeSetTarget(presencePeak.gain, pct(S.presence) * 9, ctx);

      // Air: highshelf 0..+9dB
      safeSetTarget(airShelf.gain, pct(S.air) * 9, ctx);

      // Clarity: peak 0..+8dB
      safeSetTarget(clarityPeak.gain, pct(S.clarity) * 8, ctx);

      // Warmth: tonal shelf 0..+8dB + curve intensity
      safeSetTarget(warmthShelf.gain, pct(S.warmth) * 8, ctx);
      try { warmthShaper.curve = warmthCurve(pct(S.warmth)); } catch (_) {}

      // Saturation: drive curve intensity
      try { satShaper.curve = driveCurve(pct(S.sat)); } catch (_) {}

      // Soft Clip: knee curve intensity
      try { softClipShaper.curve = softClipCurve(pct(S.soft)); } catch (_) {}

      // Exciter: harmonic send level 0..0.6
      safeSetTarget(exciterWetGain.gain, pct(S.excite) * 0.6, ctx);

      // Ultra Gain: extra output loudness, 0..+24dB on top of Hook's gain
      safeSetTarget(ultraGain.gain, dbToGain(pct(S.gain) * 24), ctx);

      // Compressor: threshold/ratio from comp amount, timing from attack/release
      const compAmt = pct(S.comp);
      safeSetTarget(compressor.threshold, -1 - compAmt * 39, ctx);
      safeSetTarget(compressor.ratio, 1 + compAmt * 11, ctx);
      safeSetValue(compressor.attack, 0.001 + pct(S.attack) * 0.099);
      safeSetValue(compressor.release, 0.01 + pct(S.release) * 0.99);

      // Limiter: brickwall ceiling, fixed fast timing for safety.
      // Ratio now scales with the slider too (was hardcoded to 20 before —
      // that meant Limiter=0% was NOT actually transparent, it was still
      // clamping every peak above -1dB, which is what caused the
      // frequent audible cutting during normal speech).
      const limitAmt = pct(S.limit);
      safeSetTarget(limiter.threshold, -0.3 - limitAmt * 23.7, ctx);
      safeSetTarget(limiter.ratio, 1 + limitAmt * 19, ctx);

      // Only route audio through the two DynamicsCompressorNodes when at
      // least one of them is actually turned on. At default (both 0%) this
      // removes their processing cost entirely instead of running them
      // silently at "no-op" settings.
      setDynamicsBypass(compAmt > 0 || limitAmt > 0);

      // Stereo Width: 0 = transparent (no delay diff), 100 = wide
      safeSetTarget(widenDelay.delayTime, pct(S.width) * 0.012, ctx);

      // Balance: -1 (left) .. 0 (center) .. +1 (right)
      if (panner) {
        safeSetTarget(panner.pan, (pct(S.balance) * 2) - 1, ctx);
      }

      // Output Mix: crossfade dry/wet
      const mixAmt = pct(S.mix);
      safeSetTarget(dryGain.gain, 1 - mixAmt, ctx);
      safeSetTarget(wetGain.gain, mixAmt, ctx);
    }

    // Initial parameter push (uses setValue directly so it applies instantly
    // on creation rather than ramping from a default of 0).
    (function initValues() {
      const prevEnabled = S.enabled;
      S.enabled = true;
      update();
      S.enabled = prevEnabled;
      if (!prevEnabled) update();
    })();

    /* ============================================================
       GATE — periodic envelope check, gentle attenuation (not full mute)
       ============================================================ */
    let gateTimer = null;
    try {
      let gateIsOpen = true;
      let gateHoldUntil = 0;
      gateTimer = setInterval(() => {
        try {
          if (!S.enabled) return;
          const gateAmt = pct(S.gate);
          if (gateAmt <= 0) {
            safeSetTarget(gateGain.gain, 1, ctx, 0.05);
            gateIsOpen = true;
            return;
          }
          gateAnalyser.getFloatTimeDomainData(gateBuf);
          let sum = 0;
          for (let i = 0; i < gateBuf.length; i++) sum += gateBuf[i] * gateBuf[i];
          const rms = Math.sqrt(sum / gateBuf.length);
          const db = rms > 0 ? 20 * Math.log10(rms) : -100;
          // Hysteresis: open threshold is higher than close threshold so a
          // syllable dip during normal speech can't flap the gate open/closed
          // (that flapping is what produces audible "cut, back, cut" chatter).
          const closeDb = -60 + gateAmt * 48;
          const openDb = closeDb + 6; // must rise 6dB above the close point to re-open
          const floor = 1 - gateAmt * 0.9; // never fully mutes -> mic stays alive
          const now = performance.now ? performance.now() : Date.now();

          if (gateIsOpen) {
            if (db < closeDb && now > gateHoldUntil) {
              gateIsOpen = false;
            }
          } else {
            if (db > openDb) {
              gateIsOpen = true;
              gateHoldUntil = now + 80; // brief hold before it can re-close
            }
          }

          const target = gateIsOpen ? 1 : Math.max(floor, 0.05);
          const tc = target < gateGain.gain.value ? (0.01 + pct(S.attack) * 0.03) : (0.02 + pct(S.release) * 0.15);
          safeSetTarget(gateGain.gain, target, ctx, tc);
        } catch (_) {}
      }, 60);
    } catch (_) {}

    /* ============================================================
       CLEANUP — stop when the input track ends, never leak timers
       ============================================================ */
    function destroy() {
      try { if (gateTimer) clearInterval(gateTimer); } catch (_) {}
      try { source.disconnect(); } catch (_) {}
      // IMPORTANT: only close the context if WE created it. If we reused
      // Hook's shared context, closing it here would kill Hook's entire
      // audio pipeline too.
      if (__weCreatedNewCtx) {
        try { ctx.close && ctx.close().catch(() => {}); } catch (_) {}
      }
      const idx = engines.indexOf(engine);
      if (idx >= 0) engines.splice(idx, 1);
    }

    try {
     
      inputStream.getAudioTracks().forEach(t => {
        t.addEventListener("ended", destroy, { once: true });
      });
    } catch (_) {}

    const engine = { ctx, dest, update, destroy };
    engines.push(engine);
    return engine;
  }

  /* ============================================================
     GUM WRAPPER — installs above whatever GUM is currently active
     ============================================================ */
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
        // Critical hand-off: if Rexx Hook v6 (or Rexx Ultra) is already
        // installed, its processed/loud stream arrives here as INPUT.
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

    Object.defineProperty(coverGetUserMedia, COVER_TAG, { value: true });
    Object.defineProperty(coverGetUserMedia, "__REXX_COVER_UPSTREAM__", { value: current });

    try {
      md.getUserMedia = coverGetUserMedia;
    } catch (_) {
      try {
        Object.defineProperty(md, "getUserMedia", {
          value: coverGetUserMedia, configurable: true, writable: true
        });
      } catch (__) {}
    }

    lastUpstream = current;
    console.log("[REXX COVER v4] wrapped current GUM");
  }

  installWrapper();

  let hookChecks = 0;
  const hookWatcher = setInterval(() => {
    const current = md.getUserMedia;
    if (current && !current[COVER_TAG] && current !== lastUpstream) {
      installWrapper();
    }
    if (++hookChecks > 120) clearInterval(hookWatcher);
  }, 100);

  setTimeout(installWrapper, 1500);
  setTimeout(installWrapper, 3000);

  /* ============================================================
     UI — floating ⚡ button + scrollable panel
     ============================================================ */
  const CSS = `
#rxcover-fab{
 position:fixed!important;left:18px!important;bottom:18px!important;
 width:52px!important;height:52px!important;border-radius:16px!important;
 border:1px solid rgba(255,255,255,.14)!important;
 background:linear-gradient(145deg,#171a24,#0c0e14)!important;color:#fff!important;
 z-index:2147483647!important;cursor:pointer!important;pointer-events:auto!important;
 touch-action:manipulation!important;-webkit-tap-highlight-color:transparent!important;
 font:700 22px/1 Arial!important;
 box-shadow:0 8px 24px rgba(0,0,0,.55),0 0 0 1px rgba(139,92,246,.15),0 0 18px rgba(139,92,246,.35)!important;
 display:flex!important;align-items:center!important;justify-content:center!important;
 user-select:none!important;
}
#rxcover-fab:active{transform:scale(0.94)!important;}
#rxcover{
 position:fixed!important;left:18px!important;bottom:78px!important;
 width:336px!important;max-width:88vw!important;max-height:76vh!important;overflow-y:auto!important;
 -webkit-overflow-scrolling:touch!important;
 padding:14px!important;border-radius:16px!important;
 background:rgba(9,10,16,.97)!important;color:#eee!important;
 border:1px solid #272b38!important;z-index:2147483646!important;
 box-shadow:0 20px 60px rgba(0,0,0,.65)!important;
 font:12px system-ui,Arial!important;backdrop-filter:blur(18px)!important;
}
#rxcover *{box-sizing:border-box}
.rc-head{display:flex;justify-content:space-between;align-items:center}
.rc-title{font-weight:900;font-size:15px;letter-spacing:.3px}
.rc-badge{font-size:9px;color:#a78bfa;background:#181522;padding:4px 7px;border-radius:7px;font-weight:700}
.rc-sub{font-size:10px;color:#8f95a3;margin:6px 0 12px;letter-spacing:.4px}
.rc-row{margin:9px 0}
.rc-line{display:flex;justify-content:space-between;margin-bottom:4px}
.rc-name{font-weight:700}
.rc-val{color:#a78bfa;font-weight:700;min-width:38px;text-align:right}
.rc-row input{width:100%;accent-color:#8b5cf6;touch-action:pan-y}
.rc-buttons{display:flex;gap:7px;margin-top:12px}
.rc-btn{flex:1;border:1px solid #303442;background:#171923;color:#eee;border-radius:9px;padding:9px;font-weight:800;cursor:pointer}
.rc-btn:active{transform:scale(0.97)}
.rc-status{margin-top:10px;padding:8px;border-radius:8px;background:#11131a;color:#9ca3af;font-size:10px}
`;

  const DEFS = [
    ["gain", "Ultra Gain"], ["pre", "Preamp"],
    ["low", "Low Boost"], ["lowcut", "Low Cut"],
    ["mid", "Mid Boost"], ["presence", "Presence"],
    ["air", "Air"], ["clarity", "Clarity"],
    ["warmth", "Warmth"], ["sat", "Saturation"],
    ["soft", "Soft Clip"], ["comp", "Compressor"],
    ["attack", "Attack"], ["release", "Release"],
    ["limit", "Limiter"], ["gate", "Gate"],
    ["width", "Stereo Width"], ["balance", "Balance"],
    ["excite", "Exciter"], ["mix", "Output Mix"]
  ];

  function addUI() {
    if (document.getElementById("rxcover-fab")) return;
    if (!document.body) { setTimeout(addUI, 300); return; }

    const st = document.createElement("style");
    st.id = "rxcover-style";
    st.textContent = CSS;
    document.head.appendChild(st);

    const fab = document.createElement("button");
    fab.id = "rxcover-fab";
    fab.type = "button";
    fab.textContent = "⚡";
    fab.title = "Rexx Cover";
    document.body.appendChild(fab);

    const box = document.createElement("div");
    box.id = "rxcover";
    box.style.display = "none";
    box.setAttribute("aria-hidden", "true");
    box.style.setProperty("pointer-events", "none", "important");

    box.innerHTML = `
      <div class="rc-head">
        <div class="rc-title">⚡ REXX COVER</div>
        <div class="rc-badge">POST-DSP</div>
      </div>
      <div class="rc-sub">POST-DSP • ABOVE REXX HOOK</div>
      <div id="rc-controls"></div>
      <div class="rc-buttons">
        <button class="rc-btn" id="rc-on" type="button">ON</button>
        <button class="rc-btn" id="rc-reset" type="button">RESET COVER</button>
      </div>
      <div class="rc-status" id="rc-status">POST-LAYER READY • waiting for mic</div>
    `;
    document.body.appendChild(box);

    const controls = box.querySelector("#rc-controls");
    const rowInputs = {};

    DEFS.forEach(([key, label]) => {
      const value = clamp(S[key], 0, 100);
      const row = document.createElement("div");
      row.className = "rc-row";
      row.innerHTML = `
        <div class="rc-line"><span class="rc-name">${label}</span>
        <span class="rc-val">${value}%</span></div>
        <input type="range" min="0" max="100" step="1" value="${value}">
      `;
      const input = row.querySelector("input");
      const val = row.querySelector(".rc-val");
      rowInputs[key] = { input, val };

      const apply = () => {
        const v = clamp(parseInt(input.value, 10), 0, 100);
        S[key] = v;
        val.textContent = v + "%";
        engines.forEach(e => { try { e.update(); } catch (_) {} });
        box.querySelector("#rc-status").textContent = "POST-LAYER • ACTIVE";
      };
      input.addEventListener("input", apply);
      input.addEventListener("change", apply);
      input.addEventListener("pointerdown", e => e.stopPropagation());
      input.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });

      controls.appendChild(row);
    });

    function syncInputsFromState() {
      DEFS.forEach(([key]) => {
        const r = rowInputs[key];
        if (!r) return;
        const v = clamp(S[key], 0, 100);
        r.input.value = v;
        r.val.textContent = v + "%";
      });
    }

    const togglePanel = (ev) => {
      if (ev) { ev.preventDefault(); ev.stopPropagation(); }
      const hidden = box.style.display === "none" || getComputedStyle(box).display === "none";
      box.style.setProperty("display", hidden ? "block" : "none", "important");
      box.style.setProperty("pointer-events", hidden ? "auto" : "none", "important");
      box.setAttribute("aria-hidden", hidden ? "false" : "true");
      if (hidden) box.scrollTop = 0;
    };
    fab.addEventListener("click", togglePanel, true);
    fab.addEventListener("touchend", togglePanel, true);
    fab.addEventListener("pointerup", togglePanel, true);

    // stop Discord's global handlers from swallowing panel interactions
    box.addEventListener("click", e => e.stopPropagation(), true);
    box.addEventListener("pointerdown", e => e.stopPropagation(), true);
    box.addEventListener("touchstart", e => e.stopPropagation(), { capture: true, passive: true });

    box.querySelector("#rc-on").onclick = (e) => {
      e.stopPropagation();
      S.enabled = !S.enabled;
      box.querySelector("#rc-on").textContent = S.enabled ? "ON" : "BYPASS";
      box.querySelector("#rc-status").textContent =
        S.enabled ? "POST-LAYER • ACTIVE" : "POST-LAYER • BYPASS (Hook still active)";
      engines.forEach(e => { try { e.update(); } catch (_) {} });
    };

    box.querySelector("#rc-reset").onclick = (e) => {
      e.stopPropagation();
      Object.assign(S, DEFAULTS, { enabled: true });
      syncInputsFromState();
      box.querySelector("#rc-on").textContent = "ON";
      box.querySelector("#rc-status").textContent = "POST-LAYER • RESET COVER (Rexx Hook untouched)";
      engines.forEach(e => { try { e.update(); } catch (_) {} });
    };
  }

  addUI();

  let tries = 0;
  const uiRetry = setInterval(() => {
    if (document.getElementById("rxcover-fab")) {
      clearInterval(uiRetry);
      return;
    }
    addUI();
    if (++tries > 40) clearInterval(uiRetry);
  }, 500);

  console.log("[REXX COVER v4] loaded — real DSP wired, above Rexx Hook");
})();
