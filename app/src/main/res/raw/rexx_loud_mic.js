(() => {
    "use strict";

    if (window.__REXX_LOUD_MIC_INSTALLED__) return;
    window.__REXX_LOUD_MIC_INSTALLED__ = true;

    const STORAGE_KEY = "rexx.loudMic.settings.v1";
    const DEFAULTS = {
        enabled: true,
        gainDb: 30,
        width: 100,
        pan: 0,
        preset: "LOUD"
    };

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, Number(value) || 0));
    }

    function loadSettings() {
        try {
            const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
            const savedGainDb = saved.preset === "LOUD" &&
                [8, 18].includes(Number(saved.gainDb))
                ? 30
                : saved.gainDb ?? DEFAULTS.gainDb;
            return {
                enabled: typeof saved.enabled === "boolean" ? saved.enabled : DEFAULTS.enabled,
                gainDb: clamp(savedGainDb, 0, 46),
                width: clamp(saved.width ?? DEFAULTS.width, 0, 200),
                pan: clamp(saved.pan ?? DEFAULTS.pan, -100, 100),
                preset: ["CLEAN", "LOUD", "CUSTOM"].includes(saved.preset)
                    ? saved.preset
                    : DEFAULTS.preset
            };
        } catch (_) {
            return { ...DEFAULTS };
        }
    }

    const state = loadSettings();
    const processors = new Set();
    const outputProcessors = new WeakMap();
    let audioContext = null;
    let captureHookReady = false;
    let panelOpen = false;
    let foreground = document.visibilityState !== "hidden";
    let animationTimer = 0;
    let permissionMessage = "";
    let host = null;
    let shadow = null;
    let ui = null;

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (_) {
            // Keep audio usable if storage is disabled or full.
        }
    }

    function ensureAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) throw new Error("Web Audio is unavailable in this WebView");
        if (!audioContext || audioContext.state === "closed") {
            audioContext = new AudioContextClass({ latencyHint: "interactive" });
        }
        if (audioContext.state === "suspended") {
            audioContext.resume().catch(() => {});
        }
        return audioContext;
    }

    function ramp(param, value, context) {
        try {
            param.cancelScheduledValues(context.currentTime);
            param.setTargetAtTime(value, context.currentTime, 0.018);
        } catch (_) {
            param.value = value;
        }
    }

    function makeLimiterCurve(enabled) {
        const curve = new Float32Array(4096);
        const threshold = 0.93;
        for (let i = 0; i < curve.length; i++) {
            const x = (i * 2) / (curve.length - 1) - 1;
            const magnitude = Math.abs(x);
            if (!enabled || magnitude <= threshold) {
                curve[i] = x;
            } else {
                const shaped = threshold + (1 - threshold) *
                    Math.tanh((magnitude - threshold) / (1 - threshold));
                curve[i] = Math.sign(x) * shaped;
            }
        }
        return curve;
    }

    function channelSummary() {
        let stereo = 0;
        let mono = 0;
        let unknown = 0;
        for (const processor of processors) {
            if (processor.channelKind === "stereo") stereo++;
            else if (processor.channelKind === "mono") mono++;
            else unknown++;
        }
        return { stereo, mono, unknown, total: processors.size };
    }

    function engineLabel() {
        if (!captureHookReady || !(window.AudioContext || window.webkitAudioContext)) {
            return "WEBVIEW AUDIO UNAVAILABLE";
        }
        if (permissionMessage && /unprocessed|Web Audio|does not expose/i.test(permissionMessage)) {
            return "DEGRADED · MIC UNPROCESSED";
        }
        if (!foreground) return "PAUSED · APP IN BACKGROUND";
        const { total } = channelSummary();
        if (total === 0) return state.enabled ? "ARMED · WAITING FOR MIC" : "READY · NO ACTIVE MIC";
        return state.enabled
            ? `PROCESSING · ${total} MIC${total === 1 ? "" : "S"}`
            : `BYPASS · ${total} MIC${total === 1 ? "" : "S"}`;
    }

    function applyProcessor(processor) {
        if (!audioContext || processor.disposed) return;
        const enabled = state.enabled;
        const gain = enabled ? Math.pow(10, state.gainDb / 20) : 1;
        ramp(processor.inputGain.gain, gain, audioContext);

        if (processor.channelKind === "stereo") {
            ramp(processor.sideScale.gain, enabled ? state.width / 100 : 1, audioContext);
            const pan = enabled ? state.pan / 100 : 0;
            const left = pan > 0 ? Math.cos(pan * Math.PI / 2) : 1;
            const right = pan < 0 ? Math.cos(Math.abs(pan) * Math.PI / 2) : 1;
            ramp(processor.panLeft.gain, left, audioContext);
            ramp(processor.panRight.gain, right, audioContext);
        } else {
            ramp(processor.monoPanner.pan, enabled ? state.pan / 100 : 0, audioContext);
        }

        ramp(processor.compressor.threshold, enabled ? -1.2 : 0, audioContext);
        ramp(processor.compressor.ratio, enabled ? 20 : 1, audioContext);
        if (processor.limiterEnabled !== enabled) {
            processor.limiter.curve = makeLimiterCurve(enabled);
            processor.limiterEnabled = enabled;
        }
    }

    function createProcessor(inputTrack) {
        const context = ensureAudioContext();
        if (context.state !== "running") {
            throw new Error("Web Audio is suspended; tap the REXX button and retry voice");
        }

        const settings = typeof inputTrack.getSettings === "function"
            ? inputTrack.getSettings()
            : {};
        const channelCount = Number(settings.channelCount) || 0;
        const channelKind = channelCount >= 2 ? "stereo" : channelCount === 1 ? "mono" : "unknown";
        const inputStream = new MediaStream([inputTrack]);
        const source = context.createMediaStreamSource(inputStream);
        const inputMeter = context.createAnalyser();
        inputMeter.fftSize = 512;
        const inputGain = context.createGain();
        const compressor = context.createDynamicsCompressor();
        compressor.attack.value = 0.003;
        compressor.release.value = 0.12;
        const limiter = context.createWaveShaper();
        limiter.oversample = "none";
        limiter.curve = makeLimiterCurve(state.enabled);
        const outputMeter = context.createAnalyser();
        outputMeter.fftSize = 512;
        const destination = context.createMediaStreamDestination();

        // The meter is a real tap of the microphone samples, before software gain.
        source.connect(inputMeter);
        inputMeter.connect(inputGain);

        const nodes = [source, inputMeter, inputGain, compressor, limiter, outputMeter, destination];
        let sideScale = null;
        let panLeft = null;
        let panRight = null;
        let monoPanner = null;

        if (channelKind === "stereo") {
            const splitter = context.createChannelSplitter(2);
            const merger = context.createChannelMerger(2);
            const midLeft = context.createGain();
            const midRight = context.createGain();
            const sideLeft = context.createGain();
            const sideRight = context.createGain();
            const midBus = context.createGain();
            const sideBus = context.createGain();
            sideScale = context.createGain();
            const sideInverter = context.createGain();
            const leftBus = context.createGain();
            const rightBus = context.createGain();
            panLeft = context.createGain();
            panRight = context.createGain();

            midLeft.gain.value = 0.5;
            midRight.gain.value = 0.5;
            sideLeft.gain.value = 0.5;
            sideRight.gain.value = -0.5;
            inputGain.connect(splitter);
            splitter.connect(midLeft, 0);
            splitter.connect(midRight, 1);
            splitter.connect(sideLeft, 0);
            splitter.connect(sideRight, 1);
            midLeft.connect(midBus);
            midRight.connect(midBus);
            sideLeft.connect(sideBus);
            sideRight.connect(sideBus);
            sideBus.connect(sideScale);
            midBus.connect(leftBus);
            sideScale.connect(leftBus);
            midBus.connect(rightBus);
            sideInverter.gain.value = -1;
            sideScale.connect(sideInverter);
            sideInverter.connect(rightBus);
            leftBus.connect(panLeft);
            rightBus.connect(panRight);
            panLeft.connect(merger, 0, 0);
            panRight.connect(merger, 0, 1);
            merger.connect(compressor);
            nodes.push(
                splitter, merger, midLeft, midRight, sideLeft, sideRight,
                midBus, sideBus, sideScale, sideInverter, leftBus, rightBus, panLeft, panRight
            );
        } else {
            monoPanner = context.createStereoPanner();
            inputGain.connect(monoPanner);
            monoPanner.connect(compressor);
            nodes.push(monoPanner);
        }

        compressor.connect(limiter);
        limiter.connect(outputMeter);
        outputMeter.connect(destination);
        const outputTrack = destination.stream.getAudioTracks()[0];
        outputTrack.enabled = inputTrack.enabled;

        const processor = {
            inputTrack,
            outputTrack,
            inputMeter,
            outputMeter,
            inputGain,
            compressor,
            limiter,
            limiterEnabled: state.enabled,
            channelKind,
            sideScale,
            panLeft,
            panRight,
            monoPanner,
            nodes,
            disposed: false,
            dispose(stopInput, stopOutput) {
                if (processor.disposed) return;
                processor.disposed = true;
                if (stopOutput && nativeTrackStop) {
                    try { nativeTrackStop.call(outputTrack); } catch (_) {}
                }
                for (const node of nodes) {
                    try { node.disconnect(); } catch (_) {}
                }
                processors.delete(processor);
                outputProcessors.delete(outputTrack);
                if (stopInput && inputTrack.readyState !== "ended") {
                    try { inputTrack.stop(); } catch (_) {}
                }
                updateUI();
            }
        };

        processors.add(processor);
        outputProcessors.set(outputTrack, processor);
        inputTrack.addEventListener("ended", () => processor.dispose(false, true), { once: true });
        outputTrack.addEventListener("ended", () => processor.dispose(true, false), { once: true });
        applyProcessor(processor);
        updateUI();
        return processor;
    }

    const trackPrototype = window.MediaStreamTrack && window.MediaStreamTrack.prototype;
    const nativeTrackStop = trackPrototype && trackPrototype.stop;
    if (trackPrototype && nativeTrackStop && !trackPrototype.__rexxStopHook) {
        try {
            Object.defineProperty(trackPrototype, "__rexxStopHook", { value: true });
            Object.defineProperty(trackPrototype, "stop", {
                configurable: true,
                writable: true,
                value: function () {
                    const processor = outputProcessors.get(this);
                    const result = nativeTrackStop.call(this);
                    if (processor) processor.dispose(true, false);
                    return result;
                }
            });
        } catch (_) {
            // Track "ended" still cleans up when a device is unplugged.
        }
    }

    function installCaptureHook() {
        const mediaDevices = navigator.mediaDevices;
        if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
            permissionMessage = "This WebView does not expose microphone capture.";
            return;
        }

        const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
        const wrappedGetUserMedia = function (constraints) {
            const wantsAudio = !!(constraints && constraints.audio);
            let contextAtGesture = null;
            if (wantsAudio && state.enabled) {
                try {
                    // Create/resume synchronously while Discord's voice-button gesture is active.
                    contextAtGesture = ensureAudioContext();
                } catch (error) {
                    permissionMessage = error.message || "Web Audio is unavailable.";
                }
            }

            return originalGetUserMedia(constraints).then(async stream => {
                const audioTracks = stream.getAudioTracks();
                // Master-off is a true raw-mic bypass; do not send a Web Audio destination
                // track when the user is troubleshooting Discord's silent-input error.
                if (!wantsAudio || !state.enabled || audioTracks.length === 0) return stream;

                const createdProcessors = [];
                try {
                    if (!contextAtGesture) contextAtGesture = ensureAudioContext();
                    if (contextAtGesture.state === "suspended") {
                        await contextAtGesture.resume();
                    }
                    if (contextAtGesture.state !== "running") {
                        throw new Error("Web Audio did not start; Discord microphone left unmodified.");
                    }
                    const processed = [];
                    for (const track of audioTracks) {
                        const processor = createProcessor(track);
                        createdProcessors.push(processor);
                        processed.push(processor.outputTrack);
                    }
                    const returnedStream = new MediaStream();
                    for (const track of stream.getVideoTracks()) returnedStream.addTrack(track);
                    for (const track of processed) returnedStream.addTrack(track);
                    permissionMessage = "";
                    updateUI();
                    return returnedStream;
                } catch (error) {
                    for (const processor of createdProcessors) processor.dispose(false, true);
                    permissionMessage = error.message || "Audio engine could not start; microphone is unprocessed.";
                    updateUI();
                    return stream;
                }
            }).catch(error => {
                if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
                    permissionMessage = "Microphone permission denied. Allow Vendroid microphone access in Android settings.";
                } else {
                    permissionMessage = error && error.message
                        ? error.message
                        : "Discord could not open the microphone.";
                }
                updateUI();
                throw error;
            });
        };

        try {
            Object.defineProperty(mediaDevices, "getUserMedia", {
                configurable: true,
                writable: true,
                value: wrappedGetUserMedia
            });
            captureHookReady = mediaDevices.getUserMedia === wrappedGetUserMedia;
        } catch (_) {
            try {
                mediaDevices.getUserMedia = wrappedGetUserMedia;
                captureHookReady = mediaDevices.getUserMedia === wrappedGetUserMedia;
            } catch (_) {
                captureHookReady = false;
            }
        }

        if (mediaDevices.addEventListener) {
            mediaDevices.addEventListener("devicechange", updateUI);
        }
        updateUI();
    }

    function setForeground(isForeground) {
        const nextForeground = !!isForeground;
        if (nextForeground !== foreground) {
            foreground = nextForeground;
            for (const processor of processors) {
                if (!foreground) {
                    processor.wasEnabledBeforeBackground = processor.inputTrack.enabled;
                    if (processor.wasEnabledBeforeBackground) processor.inputTrack.enabled = false;
                } else if (processor.wasEnabledBeforeBackground) {
                    processor.inputTrack.enabled = true;
                    processor.wasEnabledBeforeBackground = false;
                } else {
                    processor.wasEnabledBeforeBackground = false;
                }
            }
        }
        if (audioContext && audioContext.state !== "closed") {
            if (foreground && audioContext.state === "suspended") {
                audioContext.resume().catch(() => {});
            } else if (!foreground && audioContext.state === "running") {
                audioContext.suspend().catch(() => {});
            }
        }
        updateUI();
    }

    function openPanel() {
        if (!ui) return;
        panelOpen = true;
        ui.backdrop.style.display = "grid";
        ui.launcher.style.display = "none";
        try {
            ensureAudioContext();
        } catch (error) {
            permissionMessage = error.message || "Web Audio is unavailable in this WebView.";
        }
        if (audioContext && audioContext.state === "suspended" && foreground) {
            audioContext.resume().catch(() => {});
        }
        updateUI();
        startMeters();
    }

    function closePanel() {
        if (!ui) return;
        panelOpen = false;
        ui.backdrop.style.display = "none";
        ui.launcher.style.display = "flex";
        stopMeters();
    }

    function updateStatus() {
        if (!ui) return;
        ui.engineStatus.textContent = engineLabel();
        const channels = channelSummary();
        if (channels.total === 0) {
            ui.channelStatus.textContent = "WAITING FOR DISCORD MIC";
            ui.width.disabled = false;
        } else if (channels.stereo && !channels.mono && !channels.unknown) {
            ui.channelStatus.textContent = `STEREO INPUT · ${channels.stereo} SOURCE${channels.stereo === 1 ? "" : "S"}`;
            ui.width.disabled = false;
        } else if (channels.stereo) {
            ui.channelStatus.textContent = `WIDTH APPLIES TO ${channels.stereo} STEREO SOURCE${channels.stereo === 1 ? "" : "S"} · MONO BYPASSED`;
            ui.width.disabled = false;
        } else if (channels.mono && !channels.unknown) {
            ui.channelStatus.textContent = "MONO MIC · WIDTH UNAVAILABLE";
            ui.width.disabled = true;
        } else {
            ui.channelStatus.textContent = "CHANNEL COUNT UNKNOWN · WIDTH UNAVAILABLE";
            ui.width.disabled = true;
        }

        const pan = Math.round(state.pan);
        ui.panValue.textContent = pan === 0
            ? "CENTER"
            : `${pan < 0 ? "LEFT" : "RIGHT"} ${Math.abs(pan)}%`;
        if (permissionMessage) {
            ui.notice.textContent = permissionMessage;
            ui.notice.style.display = "block";
        } else if (ui.warningActive) {
            ui.notice.textContent = "High pre-limiter peak · protection is active. Hardware/ADC clipping occurs before software and cannot be repaired here.";
            ui.notice.style.display = "block";
        } else {
            ui.notice.style.display = "none";
        }
        ui.master.checked = state.enabled;
        ui.preset.value = state.preset;
    }

    function updateUI() {
        if (!ui) return;
        ui.gain.value = String(state.gainDb);
        ui.gainValue.textContent = `${state.gainDb > 0 ? "+" : ""}${state.gainDb.toFixed(1)} dB`;
        ui.width.value = String(state.width);
        ui.widthValue.textContent = `${Math.round(state.width)}%`;
        ui.pan.value = String(state.pan);
        updateStatus();
    }

    function markCustom() {
        state.preset = "CUSTOM";
        saveSettings();
        for (const processor of processors) applyProcessor(processor);
        updateUI();
    }

    function setSlider(name, value) {
        if (name === "gainDb") state.gainDb = clamp(value, 0, 46);
        if (name === "width") state.width = clamp(value, 0, 200);
        if (name === "pan") state.pan = clamp(value, -100, 100);
        markCustom();
    }

    function applyPreset(preset) {
        state.preset = preset;
        if (preset === "CLEAN") {
            state.enabled = true;
            state.gainDb = 0;
            state.width = 100;
            state.pan = 0;
        } else if (preset === "LOUD") {
            state.enabled = true;
            state.gainDb = 30;
            state.width = 100;
            state.pan = 0;
        }
        saveSettings();
        for (const processor of processors) applyProcessor(processor);
        updateUI();
    }

    function resetAll() {
        Object.assign(state, DEFAULTS);
        saveSettings();
        for (const processor of processors) applyProcessor(processor);
        updateUI();
    }

    function resetOne(name) {
        if (name === "gainDb") state.gainDb = 0;
        if (name === "width") state.width = 100;
        if (name === "pan") state.pan = 0;
        markCustom();
    }

    function readLevel(analyser) {
        if (!analyser) return null;
        const data = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
            const value = data[i];
            const magnitude = Math.abs(value);
            if (magnitude > peak) peak = magnitude;
            sum += value * value;
        }
        const rms = Math.sqrt(sum / data.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -90;
        return { peak, rms, db };
    }

    function levelPercent(db) {
        return clamp(((db + 60) / 60) * 100, 0, 100);
    }

    function startMeters() {
        stopMeters();
        const tick = () => {
            const active = [...processors].filter(processor => !processor.disposed);
            let inputDb = -90;
            let outputDb = -90;
            let highestPreLimiterPeak = 0;
            let anyUnmuted = false;
            for (const processor of active) {
                const input = readLevel(processor.inputMeter);
                const output = readLevel(processor.outputMeter);
                if (input) {
                    inputDb = Math.max(inputDb, input.db);
                    const gain = state.enabled ? Math.pow(10, state.gainDb / 20) : 1;
                    highestPreLimiterPeak = Math.max(highestPreLimiterPeak, input.peak * gain);
                }
                if (output) outputDb = Math.max(outputDb, output.db);
                if (processor.outputTrack.enabled) anyUnmuted = true;
            }
            ui.inputBar.style.width = `${levelPercent(inputDb)}%`;
            ui.outputBar.style.width = `${levelPercent(outputDb)}%`;
            ui.inputReading.textContent = inputDb <= -89 ? "−∞ dBFS" : `${inputDb.toFixed(1)} dBFS`;
            ui.outputReading.textContent = outputDb <= -89 ? "−∞ dBFS" : `${outputDb.toFixed(1)} dBFS`;
            ui.meterState.textContent = active.length === 0
                ? "NO ACTIVE MIC"
                : anyUnmuted ? "LIVE SAMPLE METERS" : "MUTED IN DISCORD";
            ui.warningActive = state.enabled && highestPreLimiterPeak >= 0.98;
            updateStatus();
            animationTimer = window.setTimeout(tick, 90);
        };
        tick();
    }

    function stopMeters() {
        if (animationTimer) window.clearTimeout(animationTimer);
        animationTimer = 0;
    }

    function mountPanel() {
        if (ui || !document.documentElement) return;
        host = document.createElement("div");
        host.id = "rexx-loud-mic-host";
        shadow = host.attachShadow({ mode: "open" });
        shadow.innerHTML = `
            <style>
                :host { all: initial; color-scheme: dark; }
                * { box-sizing: border-box; }
                button, input, select { font: inherit; }
                button { color: inherit; }
                .launcher {
                    position: fixed; z-index: 2147483000; left: 14px;
                    bottom: calc(14px + env(safe-area-inset-bottom));
                    display: flex; align-items: center; gap: 8px;
                    border: 1px solid rgba(193,147,255,.46); border-radius: 999px;
                    padding: 8px 13px 8px 8px; color: #f7efff;
                    background: linear-gradient(135deg,#27143e,#0e0c14 70%);
                    box-shadow: 0 6px 26px rgba(0,0,0,.48),0 0 18px rgba(165,92,255,.24);
                    font: 800 11px/1.1 system-ui,sans-serif; letter-spacing: .13em;
                    cursor: pointer; -webkit-tap-highlight-color: transparent;
                }
                .logo {
                    width: 27px; height: 27px; display: grid; place-items: center;
                    border-radius: 50%; color: white; font: 900 14px/1 system-ui,sans-serif;
                    background: linear-gradient(145deg,#bd78ff,#7229bb 72%);
                    box-shadow: inset 0 1px 2px rgba(255,255,255,.42),0 0 12px rgba(177,99,255,.42);
                }
                .backdrop {
                    position: fixed; z-index: 2147483001; inset: 0; display: none;
                    place-items: center; padding: max(12px,env(safe-area-inset-top)) 12px
                        max(12px,env(safe-area-inset-bottom));
                    background: rgba(4,3,8,.76); backdrop-filter: blur(12px);
                    -webkit-backdrop-filter: blur(12px); color: #f6f2fa;
                    font: 500 14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;
                }
                .panel {
                    width: min(460px,100%); max-height: min(900px,100%);
                    overflow: auto; overscroll-behavior: contain;
                    padding: 22px; border: 1px solid rgba(188,138,245,.25);
                    border-radius: 26px;
                    background: radial-gradient(ellipse at 12% 0%,rgba(103,42,155,.26),transparent 42%),
                        linear-gradient(155deg,#17131f 0%,#0b0a10 56%,#170d22 100%);
                    box-shadow: 0 22px 90px rgba(0,0,0,.62),inset 0 1px rgba(255,255,255,.06);
                    animation: enter .22s cubic-bezier(.2,.75,.2,1);
                }
                @keyframes enter { from { opacity: 0; transform: translateY(16px) scale(.985); } to { opacity: 1; transform: none; } }
                .header { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
                .brand {
                    width: 43px; height: 43px; flex:none; display:grid; place-items:center;
                    border:1px solid rgba(202,158,255,.4); border-radius:14px;
                    color:white; font-size:20px; font-weight:900;
                    background:linear-gradient(145deg,#a94df1,#391650 76%);
                    box-shadow:0 0 24px rgba(159,74,222,.22);
                }
                .title { min-width:0; flex:1; }
                .title strong { display:block; font-size:18px; line-height:1.1; letter-spacing:.13em; }
                .title small { display:block; margin-top:5px; color:#ac9eb9; font-size:10px; letter-spacing:.16em; }
                .engine { margin-top:7px; color:#c996ff; font-size:9px; font-weight:750; letter-spacing:.08em; }
                .close {
                    width:36px;height:36px;border:1px solid rgba(255,255,255,.1);border-radius:12px;
                    background:rgba(255,255,255,.055); color:#d9cfe2; font-size:21px; cursor:pointer;
                }
                .card {
                    margin: 11px 0; padding: 15px 15px 13px;
                    border: 1px solid rgba(255,255,255,.075); border-radius: 18px;
                    background:linear-gradient(135deg,rgba(255,255,255,.055),rgba(255,255,255,.022));
                }
                .card:first-of-type { padding-top:17px; }
                .row { display:flex; align-items:center; justify-content:space-between; gap:10px; }
                .label { color:#cabbd4; font-size:10px; font-weight:800; letter-spacing:.17em; }
                .value { color:#ead6ff; font-size:17px; font-weight:800; font-variant-numeric:tabular-nums; }
                .gain .value { color:#d9aaff; font-size:25px; }
                .sub { margin-top:5px; color:#8f8598; font-size:10px; line-height:1.4; }
                .channel { max-width:72%; color:#c89aff; font-size:9px; font-weight:750; letter-spacing:.06em; text-align:right; }
                .reset-one {
                    border:0; padding:4px 2px; color:#a99ab4; background:transparent;
                    font-size:10px; font-weight:700; cursor:pointer; letter-spacing:.04em;
                }
                input[type=range] {
                    appearance:none; -webkit-appearance:none; display:block; width:100%;
                    height:25px; margin:10px 0 1px; background:transparent; cursor:pointer;
                }
                input[type=range]::-webkit-slider-runnable-track {
                    height:5px; border-radius:99px;
                    background:linear-gradient(90deg,#7132a7,#ca87ff);
                    box-shadow:0 0 11px rgba(183,99,255,.18);
                }
                input[type=range]::-moz-range-track { height:5px; border-radius:99px; background:linear-gradient(90deg,#7132a7,#ca87ff); }
                input[type=range]::-webkit-slider-thumb {
                    appearance:none; -webkit-appearance:none; width:18px;height:18px;margin-top:-6.5px;
                    border:2px solid #fff; border-radius:50%; background:#bc76ff;
                    box-shadow:0 0 0 4px rgba(185,107,255,.15),0 0 15px rgba(190,111,255,.55);
                }
                input[type=range]::-moz-range-thumb {
                    width:14px;height:14px;border:2px solid #fff;border-radius:50%;background:#bc76ff;
                    box-shadow:0 0 0 4px rgba(185,107,255,.15),0 0 15px rgba(190,111,255,.55);
                }
                input[type=range]:disabled { opacity:.35; cursor:not-allowed; }
                .bounds { display:flex; justify-content:space-between; color:#716878; font-size:9px; }
                .meters { margin-top:12px; padding:0 1px; }
                .meterline { display:grid; grid-template-columns:42px 1fr 58px; align-items:center; gap:8px; margin:7px 0; }
                .metername { color:#93889d; font-size:9px; font-weight:800; letter-spacing:.1em; }
                .metertrack { height:5px; overflow:hidden; border-radius:9px; background:#28232e; }
                .meterbar { height:100%; width:0%; border-radius:inherit; background:linear-gradient(90deg,#843fc4,#cf86ff); transition:width .08s linear; }
                #outputBar { background:linear-gradient(90deg,#8b4bbd,#dfb3ff); }
                .reading { color:#8c8197; text-align:right; font:10px/1.2 ui-monospace,monospace; }
                .meterstate { margin-top:8px; color:#8e8398; font-size:9px; letter-spacing:.1em; }
                .notice {
                    display:none; margin:12px 0 4px; padding:10px 11px;
                    border:1px solid rgba(255,180,97,.22); border-radius:12px;
                    color:#edc98d; background:rgba(162,102,39,.1); font-size:10px; line-height:1.45;
                }
                .footnote { margin:12px 2px 15px; color:#817788; font-size:10px; line-height:1.5; }
                .footer { display:grid; grid-template-columns:auto auto 1fr; align-items:center; gap:9px; margin-top:14px; }
                .master {
                    display:flex; align-items:center; gap:8px; min-height:38px;
                    color:#cfc1d8; font-size:10px; font-weight:800; letter-spacing:.08em; cursor:pointer;
                }
                .master input { position:absolute; opacity:0; width:1px;height:1px; }
                .switch {
                    width:37px;height:21px;padding:3px;border-radius:99px;background:#403746;
                    transition:background .18s ease;
                }
                .switch::after { content:""; display:block; width:15px;height:15px;border-radius:50%;background:#c5bbc9;transition:transform .18s ease; }
                .master input:checked + .switch { background:#873bc0; }
                .master input:checked + .switch::after { transform:translateX(16px);background:#fff; }
                .reset-all {
                    min-height:38px;padding:0 11px;border:1px solid rgba(255,255,255,.1);border-radius:12px;
                    color:#cec0d6;background:rgba(255,255,255,.045);font-size:10px;font-weight:750;cursor:pointer;
                }
                select {
                    width:100%; min-width:0; min-height:38px; padding:0 28px 0 11px;
                    border:1px solid rgba(190,145,226,.28);border-radius:12px;color:#eadcf5;
                    background:#21182a;font-size:10px;font-weight:800;letter-spacing:.08em;
                }
                @media (max-width:520px) {
                    .backdrop { align-items:end; padding:0; }
                    .panel { width:100%; max-height:94dvh; padding:18px 16px calc(18px + env(safe-area-inset-bottom)); border-radius:25px 25px 0 0; }
                    .card { margin:9px 0; padding:13px 13px 11px; }
                    .footer { grid-template-columns:auto auto minmax(90px,1fr); gap:7px; }
                }
                @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation-duration:.01ms!important; transition-duration:.01ms!important; } }
            </style>
            <button class="launcher" type="button" aria-label="Open REXX Loud Mic controls">
                <span class="logo">R</span><span>REXX</span>
            </button>
            <div class="backdrop" role="presentation">
                <section class="panel" role="dialog" aria-modal="true" aria-label="REXX Loud Mic">
                    <header class="header">
                        <div class="brand" aria-hidden="true">R</div>
                        <div class="title">
                            <strong>LOUD MIC</strong>
                            <small>REXX · VOICE PROCESSING</small>
                            <div class="engine" id="engineStatus">READY · NO ACTIVE MIC</div>
                        </div>
                        <button class="close" type="button" aria-label="Close panel">×</button>
                    </header>
                    <div class="card gain">
                        <div class="row">
                            <span class="label">GAIN · SOFTWARE</span>
                            <span class="value" id="gainValue">+0.0 dB</span>
                        </div>
                        <div class="row">
                            <span class="sub">Digital boost · stronger settings also raise background noise</span>
                            <button class="reset-one" type="button" data-reset="gainDb">RESET</button>
                        </div>
                        <input id="gain" type="range" min="0" max="46" step="0.5" value="30" aria-label="Software input gain in decibels">
                        <div class="bounds"><span>0 dB</span><span>+46 dB · ≈200×</span></div>
                        <div class="meters">
                            <div class="meterline"><span class="metername">INPUT</span><div class="metertrack"><div class="meterbar" id="inputBar"></div></div><span class="reading" id="inputReading">−∞ dBFS</span></div>
                            <div class="meterline"><span class="metername">OUTPUT</span><div class="metertrack"><div class="meterbar" id="outputBar"></div></div><span class="reading" id="outputReading">−∞ dBFS</span></div>
                            <div class="meterstate" id="meterState">NO ACTIVE MIC</div>
                        </div>
                    </div>
                    <div class="card">
                        <div class="row">
                            <span class="label">STEREO WIDTH</span>
                            <span class="value" id="widthValue">100%</span>
                        </div>
                        <div class="row">
                            <span class="sub">Mid/side width · stereo channels only</span>
                            <span class="channel" id="channelStatus">WAITING FOR DISCORD MIC</span>
                        </div>
                        <div class="row">
                            <input id="width" type="range" min="0" max="200" step="1" value="100" aria-label="Stereo width percent">
                            <button class="reset-one" type="button" data-reset="width">RESET</button>
                        </div>
                        <div class="bounds"><span>0% · MONO</span><span>200% · WIDE</span></div>
                    </div>
                    <div class="card">
                        <div class="row">
                            <span class="label">LEFT / RIGHT PANNING</span>
                            <span class="value" id="panValue">CENTER</span>
                        </div>
                        <div class="row">
                            <span class="sub">Center stays balanced · mono is output balance only</span>
                            <button class="reset-one" type="button" data-reset="pan">RESET</button>
                        </div>
                        <input id="pan" type="range" min="-100" max="100" step="1" value="0" aria-label="Left and right output balance">
                        <div class="bounds"><span>LEFT</span><span>CENTER</span><span>RIGHT</span></div>
                    </div>
                    <div class="notice" id="notice" role="status"></div>
                    <p class="footnote">+46 dB is about 200× digital amplitude; the limiter protects peaks, but high boost raises room noise. If Discord shows 3002, turn MASTER off and rejoin to send the raw mic. Android does not expose hardware mic gain.</p>
                    <footer class="footer">
                        <label class="master">
                            <input id="master" type="checkbox" aria-label="Master processing on or off">
                            <span class="switch" aria-hidden="true"></span><span>MASTER</span>
                        </label>
                        <button class="reset-all" type="button" id="resetAll">RESET ALL</button>
                        <select id="preset" aria-label="Audio preset">
                            <option value="CLEAN">CLEAN</option>
                            <option value="LOUD">LOUD</option>
                            <option value="CUSTOM">CUSTOM</option>
                        </select>
                    </footer>
                </section>
            </div>
        `;

        document.documentElement.appendChild(host);
        const $ = selector => shadow.querySelector(selector);
        ui = {
            launcher: $(".launcher"),
            backdrop: $(".backdrop"),
            panel: $(".panel"),
            engineStatus: $("#engineStatus"),
            channelStatus: $("#channelStatus"),
            gain: $("#gain"),
            gainValue: $("#gainValue"),
            width: $("#width"),
            widthValue: $("#widthValue"),
            pan: $("#pan"),
            panValue: $("#panValue"),
            master: $("#master"),
            preset: $("#preset"),
            notice: $("#notice"),
            inputBar: $("#inputBar"),
            outputBar: $("#outputBar"),
            inputReading: $("#inputReading"),
            outputReading: $("#outputReading"),
            meterState: $("#meterState"),
            warningActive: false
        };

        ui.launcher.addEventListener("click", openPanel);
        $(".close").addEventListener("click", closePanel);
        ui.backdrop.addEventListener("click", event => {
            if (event.target === ui.backdrop) closePanel();
        });
        ui.panel.addEventListener("click", event => event.stopPropagation());
        ui.gain.addEventListener("input", () => setSlider("gainDb", ui.gain.value));
        ui.width.addEventListener("input", () => setSlider("width", ui.width.value));
        ui.pan.addEventListener("input", () => setSlider("pan", ui.pan.value));
        ui.master.addEventListener("change", () => {
            state.enabled = ui.master.checked;
            state.preset = "CUSTOM";
            saveSettings();
            for (const processor of processors) applyProcessor(processor);
            updateUI();
        });
        ui.preset.addEventListener("change", () => applyPreset(ui.preset.value));
        $("#resetAll").addEventListener("click", resetAll);
        shadow.querySelectorAll("[data-reset]").forEach(button => {
            button.addEventListener("click", () => resetOne(button.getAttribute("data-reset")));
        });

        updateUI();
    }

    function ensurePanel() {
        if (ui) return;
        if (document.documentElement) mountPanel();
        if (!ui) document.addEventListener("DOMContentLoaded", mountPanel, { once: true });
    }

    function shutdown() {
        closePanel();
        for (const processor of [...processors]) processor.dispose(true, true);
        if (audioContext && audioContext.state !== "closed") {
            audioContext.close().catch(() => {});
            audioContext = null;
        }
    }

    ensurePanel();
    installCaptureHook();

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && panelOpen) {
            event.stopPropagation();
            closePanel();
        }
    }, true);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") setForeground(false);
        else setForeground(true);
    });
    window.addEventListener("pagehide", shutdown, { once: true });

    if (window.VencordMobile && typeof window.VencordMobile.onBackPress === "function") {
        const originalBackPress = window.VencordMobile.onBackPress.bind(window.VencordMobile);
        window.VencordMobile.onBackPress = function () {
            if (panelOpen) {
                closePanel();
                return true;
            }
            return originalBackPress();
        };
    }

    window.__REXX_LOUD_MIC__ = {
        setForeground,
        isPanelOpen: () => panelOpen,
        engineStatus: engineLabel,
        shutdown
    };
})();
