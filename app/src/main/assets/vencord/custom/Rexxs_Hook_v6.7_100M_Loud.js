(function(){
'use strict';
if(window.__RHv6)return;
window.__RHv6=true;

/* ═══════════════════════════════════════════════════════════
   REXX'S HOOK v6.7 — REAL 100M GAIN · MULTI-STAGE LOUD · 50 VOICE FX
   Architecture: Hook v5 passthrough-first stability
   Features:     REXXCORD Ultimate processing + UI
   ─────────────────────────────────────────────────────────
   - Passthrough-first getUserMedia (mic NEVER stuck)
   - AudioContext patch captures DiscordContext
   - All DSP in single AudioWorkletProcessor
   - Rescue overlay for suspended AudioContext
   - Fake Mute / Real Deafen (4-layer protection)
   - Gain: 1× to 100,000,000× (log scale)
   - Distortion: raw at 500% — brutal, no output limiter
   - 10-band EQ, Psycho EQ, Pitch, all FX in worklet
═══════════════════════════════════════════════════════════ */

/* ── FAKE MUTE / REAL DEAFEN — 4-layer protection ──────── */
window.RHFakeMute   = false;
window.RHRealDeafen = false;

var _ownMicTracks      = new Set();
var _remoteAudioTracks = new Set();

var _origEnabledDesc = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'enabled');
if(_origEnabledDesc){
  Object.defineProperty(MediaStreamTrack.prototype,'enabled',{
    get:function(){ return _origEnabledDesc.get.call(this); },
    set:function(val){
      if(!val && window.RHFakeMute && _ownMicTracks.has(this)) return;
      _origEnabledDesc.set.call(this, val);
    },
    configurable:true, enumerable:true
  });
}
if(window.RTCRtpSender){
  var _origReplace = RTCRtpSender.prototype.replaceTrack;
  RTCRtpSender.prototype.replaceTrack = function(track){
    if(track===null && window.RHFakeMute) return Promise.resolve();
    return _origReplace.call(this, track);
  };
}
if(window.MediaStream && MediaStream.prototype.removeTrack){
  var _origRemove = MediaStream.prototype.removeTrack;
  MediaStream.prototype.removeTrack = function(track){
    if(window.RHFakeMute && _ownMicTracks.has(track)) return;
    return _origRemove.call(this, track);
  };
}
var _origStop = MediaStreamTrack.prototype.stop;
MediaStreamTrack.prototype.stop = function(){
  if(window.RHFakeMute && this.kind==='audio' && _ownMicTracks.has(this)) return;
  return _origStop.call(this);
};
function _captureRemoteTrack(track){
  if(!track || track.kind!=='audio') return;
  _remoteAudioTracks.add(track);
  if(window.RHRealDeafen) _origEnabledDesc.set.call(track, false);
  track.addEventListener('ended', function(){ _remoteAudioTracks.delete(track); });
}
if(window.RTCPeerConnection){
  var _origAddEvt = RTCPeerConnection.prototype.addEventListener;
  RTCPeerConnection.prototype.addEventListener = function(type, fn){
    var rest = Array.prototype.slice.call(arguments, 2);
    if(type==='track'){
      var wrapped = function(e){ _captureRemoteTrack(e.track); return fn.call(this, e); };
      return _origAddEvt.apply(this, [type, wrapped].concat(rest));
    }
    return _origAddEvt.apply(this, arguments);
  };
}
window.RHApplyRealDeafen = function(active){
  window.RHRealDeafen = active;
  _remoteAudioTracks.forEach(function(track){
    if(track.readyState!=='ended'){
      try{ _origEnabledDesc.set.call(track, !active); }catch(e){}
    }
  });
  document.querySelectorAll('audio,video').forEach(function(el){
    el.volume = active ? 0 : 1;
    try{ el.muted = active; }catch(e){}
  });
};

/* ── STATE ──────────────────────────────────────────────── */
var S = {
  // Gain (0-100 log slider → 1× to 100M×)
  gain:0,
  // Distortion
  dist:0, sat:0, distDry:0.2,
  // Psycho EQ
  presence:0, subBody:0, exciter:0,
  // Pitch
  pit:0,
  // 10-band EQ (dB, -15 to +15)
  eq:[0,0,0,0,0,0,0,0,0,0],
  // FX toggles (0-1)
  robot:0, tremolo:0, stutter:0, bitcrush:0,
  chorus:0, flanger:0, wider:0,
  // Wider engine
  widerWidth:0, widerDist:0, widerSat:0, widerBass:0, widerAir:0, widerGain:1,
  // Space
  echo:0, etime:0.5, efb:0,
  reverb:0,
  // Dynamics
  comp:0, gate:0,
  // Quick EQ
  bass:0, air:0, clean:0, shout:0,
  // Chaos
  chaos:0,
  // 5-Stage Gain Boost: 10× / 20× / 40× / 80× / 160×
  g1:1, g2:1, g3:1, g4:1, g5:1,
  // Legacy
  crush:0, volt:0, rep:0,
  // Power
  fakeMute:false, realDeafen:false,
  // Stats
  clipCount:0, peakDb:-Infinity, inputLevel:-Infinity,
  sessionStart:Date.now()
};

window.DiscordContext = null;

/* ── 1. PATCH AudioContext (capture DiscordContext) ─────── */
var _NAC = window.AudioContext || window.webkitAudioContext;
window.AudioContext = function(o){
  var ctx = new _NAC(Object.assign({latencyHint:'interactive', sampleRate:48000}, o||{}));
  window.DiscordContext = ctx;
  return ctx;
};
window.AudioContext.prototype = _NAC.prototype;

/* ── 2. PATCH getUserMedia — PASSTHROUGH FIRST ──────────
   CRITICAL: return dest.stream BEFORE worklet loads.
   Mic is NEVER stuck — passthrough is instant.
─────────────────────────────────────────────────────────── */
var _gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

navigator.mediaDevices.getUserMedia = function(constraints){
  if(constraints && constraints.audio){
    var devId = (constraints.audio && constraints.audio.deviceId) || undefined;
    constraints.audio = {
      deviceId        : devId,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl : false,
      sampleRate      : 48000,
      channelCount    : 2
    };
  }

  return _gum(constraints).then(function(rawStream){
    rawStream.getAudioTracks().forEach(function(t){ _ownMicTracks.add(t); });

    var ctx = window.DiscordContext;
    if(!ctx){
      setTimeout(function(){ CHAIN.tryInject(rawStream); }, 500);
      return rawStream;
    }

    /* Create passthrough destination immediately — mic works NOW */
    var src  = ctx.createMediaStreamSource(rawStream);
    var dest = ctx.createMediaStreamDestination();

    /* Passthrough: Discord gets audio instantly */
    src.connect(dest);

    /* Load worklet async — inserted between src and dest when ready */
    CHAIN.loadWorklet(ctx, src, dest);

    /* Return BEFORE worklet loads = no stuck mic */
    return dest.stream;

  }).catch(function(e){
    console.warn('[RHv6] gum error', e);
    return _gum(constraints);
  });
};

/* ── 3. WORKLET CODE ────────────────────────────────────── */
var WK = `class RHv6 extends AudioWorkletProcessor {
  static get parameterDescriptors(){
    const p = (name,def,mn,mx) => ({name,defaultValue:def,minValue:mn??0,maxValue:mx??1,automationRate:'k-rate'});
    return [
      p('gain',1,1,100000000000000000),
      p('dist',0,0,10),
      p('sat',0,0,1),
      p('distDry',0.2,0,1),
      p('presence',0,-6,15),
      p('subBody',0,0,12),
      p('exciter',0,0,1),
      p('pit',0,-12,12),
      p('eq0'  ,0,-15,15), p('eq1',0,-15,15), p('eq2',0,-15,15), p('eq3',0,-15,15),
      p('eq4'  ,0,-15,15), p('eq5',0,-15,15), p('eq6',0,-15,15), p('eq7',0,-15,15),
      p('eq8'  ,0,-15,15), p('eq9',0,-15,15),
      p('robot',0,0,1), p('tremolo',0,0,1), p('stutter',0,0,1), p('bitcrush',0,0,1),
      p('chorus',0,0,1), p('flanger',0,0,1), p('wider',0,0,1),
      p('echo',0,0,1), p('etime',0.5,0,1), p('efb',0,0,1),
      p('reverb',0,0,1),
      p('gate',0,0,1),
      p('bass',0,0,1), p('air',0,0,1), p('clean',0,0,1), p('shout',0,0,1),
      p('chaos',0,0,1),
      p('crush',0,0,1), p('volt',0,0,1), p('rep',0,0,1),
      p('widerWidth',0,0,1), p('widerDist',0,0,10),
      p('widerSat',0,0,1), p('widerBass',0,0,1), p('widerAir',0,0,1),
      p('widerGain',1,1,20),
    ];
  }

  constructor(){
    super();
    const sr = sampleRate;

    /* ── EQ state: 12 biquad filters (10 bands + presence + subBody) ── */
    this.eq = [];
    for(let i=0;i<12;i++){
      this.eq.push({x1L:0,x2L:0,y1L:0,y2L:0, x1R:0,x2R:0,y1R:0,y2R:0,
                    b0:1,b1:0,b2:0,a1:0,a2:0, lastG:null,lastF:null,lastQ:null});
    }
    this.EQ_FREQS = [60,150,400,1000,2400,6000,12000,16000,80,8000];
    this.EQ_Q     = [1.0,1.2,1.2,1.2,1.2,1.2,1.2,1.2,0.7,0.7];

    /* ── Bass / Air / Clean / Shout 1-pole state ── */
    this.bpL=0; this.bpR=0;    // bass LP
    this.hpL=0; this.hpR=0;    // clean HP
    this.apL=0; this.apR=0;    // clean presence add
    this.exL=0; this.exR=0;    // exciter HPF
    this.airL=0; this.airR=0;  // air HPF (for boost)

    /* ── Pitch shift buffers ── */
    const pb = Math.min(32768, Math.max(8192, sr*.35|0));
    this.pb=pb;
    this.pL=new Float32Array(pb); this.pR=new Float32Array(pb);
    this.pw=2048; this.pr1=0; this.pr2=1024; this.ph1=0; this.ph2=.5;

    /* ── Echo (delay) ── */
    const eLen = sr * 2;
    this.dL=new Float32Array(eLen); this.dR=new Float32Array(eLen); this.di=0; this.dLen=eLen;

    /* ── Reverb (feedback comb) ── */
    this.rvL=new Float32Array(8192); this.rvR=new Float32Array(8192); this.ri=0;

    /* ── Chorus ── */
    const cLen = sr*.2|0;
    this.cBL=new Float32Array(cLen+8); this.cBR=new Float32Array(cLen+8);
    this.cLen=cLen; this.ci=0; this.cph=0;

    /* ── Flanger ── */
    const fLen = sr*.05|0;
    this.fBL=new Float32Array(fLen+8); this.fBR=new Float32Array(fLen+8);
    this.fLen=fLen; this.fi=0; this.fph=0; this.ffbL=0; this.ffbR=0;

    /* ── Repeater ── */
    const rm = Math.min(sr*2, sr*.8|0);
    this.rbL=new Float32Array(rm); this.rbR=new Float32Array(rm);
    this.rm=rm; this.rs=0; this.rpos=0; this.rl=0; this.rsil=0; this.rn=0; this.rg=0;

    /* ── Modulation oscillator phases ── */
    this.rph=0;  // robot ring mod
    this.tph=0;  // tremolo LFO
    this.sc=0;   // stutter counter

    /* ── Compressor envelope ── */
    this.env=0;

    /* ── Haas buffer (wider — generates true stereo from mono) ── */
    const hLen = (sr*.035|0)+8;
    this.hBuf=new Float32Array(hLen); this.hBufLen=hLen; this.hi=0;
  }

  /* ── Biquad coefficient helpers ── */
  _peakCoeff(eq, freq, gainDb, Q){
    if(eq.lastG===gainDb && eq.lastF===freq) return;
    eq.lastG=gainDb; eq.lastF=freq;
    const A    = Math.pow(10, gainDb/40);
    const w0   = 2*Math.PI*freq/sampleRate;
    const cos0 = Math.cos(w0);
    const sin0 = Math.sin(w0);
    const alpha= sin0/(2*(Q||1.2));
    const a0   = 1+alpha/A;
    eq.b0=(1+alpha*A)/a0; eq.b1=eq.a1=(-2*cos0)/a0;
    eq.b2=(1-alpha*A)/a0; eq.a2=(1-alpha/A)/a0;
  }

  _lowShelfCoeff(eq, freq, gainDb){
    if(eq.lastG===gainDb && eq.lastF===freq) return;
    eq.lastG=gainDb; eq.lastF=freq;
    const A    = Math.pow(10, gainDb/40);
    const w0   = 2*Math.PI*freq/sampleRate;
    const cos0 = Math.cos(w0); const sin0 = Math.sin(w0);
    const sA   = Math.sqrt(A); const alpha = sin0/2;
    const b0   = A*((A+1)-(A-1)*cos0+2*sA*alpha);
    const b1   = 2*A*((A-1)-(A+1)*cos0);
    const b2   = A*((A+1)-(A-1)*cos0-2*sA*alpha);
    const a0   = (A+1)+(A-1)*cos0+2*sA*alpha;
    const a1i  = -2*((A-1)+(A+1)*cos0);
    const a2i  = (A+1)+(A-1)*cos0-2*sA*alpha;
    eq.b0=b0/a0; eq.b1=b1/a0; eq.b2=b2/a0; eq.a1=a1i/a0; eq.a2=a2i/a0;
  }

  _highShelfCoeff(eq, freq, gainDb){
    if(eq.lastG===gainDb && eq.lastF===freq) return;
    eq.lastG=gainDb; eq.lastF=freq;
    const A    = Math.pow(10, gainDb/40);
    const w0   = 2*Math.PI*freq/sampleRate;
    const cos0 = Math.cos(w0); const sin0 = Math.sin(w0);
    const sA   = Math.sqrt(A); const alpha = sin0/2;
    const b0   = A*((A+1)+(A-1)*cos0+2*sA*alpha);
    const b1   = -2*A*((A-1)+(A+1)*cos0);
    const b2   = A*((A+1)+(A-1)*cos0-2*sA*alpha);
    const a0   = (A+1)-(A-1)*cos0+2*sA*alpha;
    const a1i  = 2*((A-1)-(A+1)*cos0);
    const a2i  = (A+1)-(A-1)*cos0-2*sA*alpha;
    eq.b0=b0/a0; eq.b1=b1/a0; eq.b2=b2/a0; eq.a1=a1i/a0; eq.a2=a2i/a0;
  }

  _bqL(s, x){
    const y = s.b0*x + s.b1*s.x1L + s.b2*s.x2L - s.a1*s.y1L - s.a2*s.y2L;
    s.x2L=s.x1L; s.x1L=x; s.y2L=s.y1L; s.y1L=y;
    return isFinite(y)?y:0;
  }
  _bqR(s, x){
    const y = s.b0*x + s.b1*s.x1R + s.b2*s.x2R - s.a1*s.y1R - s.a2*s.y2R;
    s.x2R=s.x1R; s.x1R=x; s.y2R=s.y1R; s.y1R=y;
    return isFinite(y)?y:0;
  }

  /* ── Cubic hermite interpolation for pitch shift ── */
  _readBuf(buf, pos, size){
    const i0 = ((pos|0) + size) % size;
    const i1 = (i0+1) % size;
    const f  = pos - (pos|0);
    return buf[i0]*(1-f) + buf[i1]*f;
  }

  process(inp, out, p){
    const i0 = inp[0]; const o0 = out[0];
    if(!i0 || !i0[0]) return true;
    const len = i0[0].length;
    try {

    /* Read k-rate params once per block */
    const G   = p.gain[0];
    const DT  = p.dist[0];    // 0-5 (0-500%)
    const SAT = p.sat[0];
    const DRY = p.distDry[0];
    const PRE = p.presence[0];
    const SUB = p.subBody[0];
    const EX  = p.exciter[0];
    const PI  = p.pit[0];
    const RB  = p.robot[0];
    const TR  = p.tremolo[0];
    const ST  = p.stutter[0];
    const BC  = p.bitcrush[0];
    const CH  = p.chorus[0];
    const FL  = p.flanger[0];
    const WI  = p.wider[0];
    const WW  = p.widerWidth[0];
    const WD  = p.widerDist[0];
    const WS  = p.widerSat[0];
    const WB  = p.widerBass[0];
    const WA  = p.widerAir[0];
    const WG  = p.widerGain[0];
    const EC  = p.echo[0];
    const ET  = p.etime[0];
    const EF  = p.efb[0];
    const RV  = p.reverb[0];
    const GA  = p.gate[0];
    const BA  = p.bass[0];
    const AI  = p.air[0];
    const CL  = p.clean[0];
    const SH  = p.shout[0];
    const CHAOS = p.chaos[0];
    const CR  = p.crush[0];
    const VO  = p.volt[0];
    const RE  = p.rep[0];

    /* Effective params when chaos active */
    const eDT  = CHAOS>0 ? 10    : DT;
    const ePRE = CHAOS>0 ? 15    : PRE;
    const eSUB = CHAOS>0 ? 12    : SUB;
    const eEX  = CHAOS>0 ? 1     : EX;

    /* Update EQ coefficients (block rate) */
    const eqGains = [p.eq0[0],p.eq1[0],p.eq2[0],p.eq3[0],p.eq4[0],
                     p.eq5[0],p.eq6[0],p.eq7[0],p.eq8[0],p.eq9[0]];
    for(let b=0;b<10;b++){
      const s = this.eq[b]; const f = this.EQ_FREQS[b]; const g = eqGains[b]; const q = this.EQ_Q[b];
      if(b===8) this._lowShelfCoeff(s, 80, g);
      else if(b===9) this._highShelfCoeff(s, 8000, g);
      else this._peakCoeff(s, f, g, q);
    }
    /* Presence biquad (idx 10) */
    this._peakCoeff(this.eq[10], 2500, ePRE, 0.9);
    /* SubBody low shelf (idx 11) */
    this._lowShelfCoeff(this.eq[11], 80, eSUB);

    /* REAL 100M MASTER GAIN.
       Gain is intentionally applied at the FINAL stage so every boost slider
       remains effective instead of getting destroyed by an early ±1 clip.
       No compressor and no limiter are inserted anywhere in this chain. */
    const Gval = Math.max(1, Math.min(1e16, G));

    for(let i=0;i<len;i++){
      let L = i0[0][i] || 0;
      let R = (i0[1] ? i0[1][i] : L) || 0;

      /* ─ GATE ─ */
      if(GA>0){
        const av = (Math.abs(L)+Math.abs(R))*.5;
        if(av < 0.003+GA*.05){ L*=(1-GA)*.05; R*=(1-GA)*.05; }
      }

      /* ─ CLEAN (HP rumble removal + presence) ─ */
      if(CL>0){
        const ca = 0.004+CL*.12;
        this.hpL += ca*(L-this.hpL); this.hpR += ca*(R-this.hpR);
        L -= this.hpL; R -= this.hpR;
        const dL=L-this.apL, dR=R-this.apR;
        this.apL=L; this.apR=R;
        L += dL*CL*.4; R += dR*CL*.4;
      }

      /* ─ DISTORTION — before final master gain so every gain stage remains
         effective. Raw character: NO limiting, NO compression. ─ */
      if(eDT>0){
        const dk    = 1 + eDT*300;           // 1→3001 at 1000% — maximal brutality
        const blend = Math.min(1, eDT/2.0);  // full square wave at 200%+
        /* atan waveshaper (warm at low, saturating at high) */
        const atanL = Math.atan(L*dk)/(Math.PI/2);
        const atanR = Math.atan(R*dk)/(Math.PI/2);
        /* brutal sign-clip (perfect square wave at blend=1) */
        const hcL = L>0?1:L<0?-1:0;
        const hcR = R>0?1:R<0?-1:0;
        const distL = atanL*(1-blend) + hcL*blend;
        const distR = atanR*(1-blend) + hcR*blend;
        /* parallel saturation on shaped signal */
        let satL=0, satR=0;
        if(SAT>0){
          const k = 2*Math.min(0.98,SAT)/(1-Math.min(0.98,SAT));
          satL = (1+k)*distL/(1+k*Math.abs(distL)) - distL;
          satR = (1+k)*distR/(1+k*Math.abs(distR)) - distR;
        }
        L = distL + satL*SAT*.5;
        R = distR + satR*SAT*.5;
      }

      /* Gain is deliberately NOT applied here. It is applied once at the
         very end, after all character processing, so g1..g5 and master Gain
         always produce a measurable level increase. */

      /* ─ BASS BOOST ─ */
      if(BA>0){
        const bc = 0.025+BA*.3;
        this.bpL += bc*(L-this.bpL); this.bpR += bc*(R-this.bpR);
        L += this.bpL*BA*3; R += this.bpR*BA*3;
      }

      /* ─ SHOUT (formant scream) ─ */
      if(SH>0){ L*=(1+SH*7); R*=(1+SH*7); }

      /* ─ CRUSH (sample crush) ─ */
      if(CR>0){
        const k = 1+CR*10;
        L = L*(Math.abs(L)+k)/(L*L+k);
        R = R*(Math.abs(R)+k)/(R*R+k);
      }

      /* ─ DC BIAS ─ */
      if(VO>0){ L+=VO*.15*(L>0?.5:-.5); R+=VO*.15*(R>0?.5:-.5); }

      /* ─ BITCRUSH ─ */
      if(BC>0){
        const bits = Math.max(2, Math.round(16-BC*14));
        const q    = Math.pow(2, bits-1);
        L=Math.round(L*q)/q; R=Math.round(R*q)/q;
      }

      /* ─ 10-BAND EQ ─ */
      for(let b=0;b<10;b++){
        if(eqGains[b]!==0){
          L = this._bqL(this.eq[b], L);
          R = this._bqR(this.eq[b], R);
        }
      }

      /* ─ PRESENCE peaking @ 2500Hz ─ */
      if(ePRE!==0){
        L = this._bqL(this.eq[10], L);
        R = this._bqR(this.eq[10], R);
      }

      /* ─ SUB BODY low shelf @ 80Hz ─ */
      if(eSUB!==0){
        L = this._bqL(this.eq[11], L);
        R = this._bqR(this.eq[11], R);
      }

      /* ─ HARMONIC EXCITER (HPF → tanh → mix) ─ */
      if(eEX>0){
        const ha = 0.45;  // ~4kHz HPF alpha
        this.exL += ha*(L-this.exL); this.exR += ha*(R-this.exR);
        const hpL = L-this.exL; const hpR = R-this.exR;
        L += Math.tanh(hpL*3)*eEX*.6;
        R += Math.tanh(hpR*3)*eEX*.6;
      }

      /* ─ AIR (high shelf boost) ─ */
      if(AI>0){
        const aa = 0.35;  // ~8kHz HPF
        this.airL += aa*(L-this.airL); this.airR += aa*(R-this.airR);
        L += (L-this.airL)*AI*.8; R += (R-this.airR)*AI*.8;
      }

      /* ─ COMPRESSOR — REMOVED (was causing mute/break at high gain) ─ */

      /* ─ ROBOT (ring modulation) ─ */
      if(RB>0){
        const rm2 = Math.sin(6.2832*this.rph);
        this.rph  = (this.rph+(70+RB*280)/sampleRate)%1;
        L = L*(1-RB) + L*rm2*RB;
        R = R*(1-RB) + R*rm2*RB;
      }

      /* ─ TREMOLO ─ */
      if(TR>0){
        const tm = (1+Math.sin(6.2832*this.tph))*.5;
        this.tph  = (this.tph+(2+TR*13)/sampleRate)%1;
        const tg  = 1-TR*.9+tm*TR*.9;
        L*=tg; R*=tg;
      }

      /* ─ STUTTER ─ */
      if(ST>0){
        const cl2 = Math.max(1, sampleRate*(.06-ST*.055)|0);
        this.sc   = (this.sc+1)%(cl2*2);
        if(this.sc<cl2){ L=0; R=0; }
      }

      /* ─ PITCH SHIFT (granular) ─ */
      if(PI!==0){
        const rt = Math.pow(2, Math.max(-12,Math.min(12,PI))/12);
        this.pL[this.pw]=L; this.pR[this.pw]=R;
        const f1 = .5-.5*Math.cos(6.2832*this.ph1);
        const f2 = .5-.5*Math.cos(6.2832*this.ph2);
        const dd = f1+f2+1e-6;
        L = (this._readBuf(this.pL,this.pr1,this.pb)*f1 + this._readBuf(this.pL,this.pr2,this.pb)*f2)/dd;
        R = (this._readBuf(this.pR,this.pr1,this.pb)*f1 + this._readBuf(this.pR,this.pr2,this.pb)*f2)/dd;
        this.pw  = (this.pw+1)%this.pb;
        this.pr1 = (this.pr1+rt)%this.pb; this.pr2=(this.pr2+rt)%this.pb;
        this.ph1 = (this.ph1+rt/2048)%1;  this.ph2=(this.ph2+rt/2048)%1;
      }

      /* ─ CHORUS ─ */
      if(CH>0){
        this.cBL[this.ci]=L; this.cBR[this.ci]=R;
        const cmod = (Math.sin(6.2832*this.cph)+1)*.5;
        this.cph   = (this.cph+1.5/sampleRate)%1;
        const cd   = Math.max(0.001,(0.015+cmod*0.015)*sampleRate)|0;
        const cidx = ((this.ci - cd) + this.cLen + 8) % (this.cLen+8);
        L = L*(1-CH*.5) + this.cBL[cidx]*CH*.5;
        R = R*(1-CH*.5) + this.cBR[cidx]*CH*.5;
        this.ci = (this.ci+1)%(this.cLen+8);
      }

      /* ─ FLANGER ─ */
      if(FL>0){
        this.fBL[this.fi]=L+this.ffbL*FL*.45;
        this.fBR[this.fi]=R+this.ffbR*FL*.45;
        const fmod = (Math.sin(6.2832*this.fph)+1)*.5;
        this.fph   = (this.fph+0.5/sampleRate)%1;
        const fd   = Math.max(0.0001,(0.001+fmod*0.006)*sampleRate)|0;
        const fidx = ((this.fi - fd) + this.fLen + 8) % (this.fLen+8);
        const flL  = this.fBL[fidx]; const flR = this.fBR[fidx];
        this.ffbL  = flL; this.ffbR = flR;
        L = L*(1-FL*.6) + flL*FL*.6;
        R = R*(1-FL*.6) + flR*FL*.6;
        this.fi = (this.fi+1)%(this.fLen+8);
      }

      /* ─ WIDER (Haas + M/S hybrid — works on MONO AND stereo input) ─
         Haas delay creates real stereo from mono Discord mic (L=R).
         M/S expansion adds extra width on top when signal is stereo.
         Combined = width on every mic type. */
      if(WW>0){
        /* Haas delay — write L, read delayed version for R */
        this.hBuf[this.hi] = L;
        const hd  = Math.max(1, (0.005 + WW * 0.010) * sampleRate) | 0; // 5–15ms
        const hri = (this.hi + this.hBufLen - hd) % this.hBufLen;
        const haas = this.hBuf[hri];
        this.hi   = (this.hi + 1) % this.hBufLen;

        /* M/S expansion (adds width on top of Haas for stereo inputs) */
        const m  = (L + R) * 0.5;
        let   sd = (L - R) * 0.5 * (1 + WW * 0.8) * WG;

        /* distortion on side signal — raw, no output limiter */
        if(WD>0){
          const wdk   = 1 + WD*300;
          const blend = Math.min(1, WD/2);
          const dAtan = Math.atan(sd*wdk)/(Math.PI/2);
          const dHard = Math.max(-1,Math.min(1,sd*wdk));
          sd = dAtan*(1-blend) + dHard*blend;
        }

        /* saturation on side */
        if(WS>0){
          const k = 2*Math.min(0.98,WS)/(1-Math.min(0.98,WS));
          sd = (1+k)*sd/(1+k*Math.abs(sd));
        }

        /* bass boost on wide — 1-pole LP mixed back into side */
        if(WB>0){
          if(!this.wbL) this.wbL=0;
          const bc = 0.025+WB*.3;
          this.wbL += bc*(sd-this.wbL);
          sd += this.wbL*WB*2;
        }

        /* air on wide — HPF shimmer added to side */
        if(WA>0){
          if(!this.waL) this.waL=0;
          const aa = 0.35;
          this.waL += aa*(sd-this.waL);
          sd += (sd-this.waL)*WA*.8;
        }

        /* Merge: L = mid+side, R = mid-side + Haas delay (real stereo from mono) */
        L = m + sd;
        R = m - sd + haas * WW * Math.max(1, WG * 0.5);
      }

      /* ─ REVERB (feedback comb) ─ */
      if(RV>0){
        const rd   = Math.min(8190, 400+(RV*4200|0));
        const ridx = (this.ri+(8192-rd))&8191;
        const rrl  = this.rvL[ridx]; const rrr = this.rvR[ridx];
        this.rvL[this.ri] = L+rrl*(.15+RV*.65);
        this.rvR[this.ri] = R+rrr*(.15+RV*.65);
        this.ri = (this.ri+1)&8191;
        L = L*(1-RV*.4)+rrl*RV*.4;
        R = R*(1-RV*.4)+rrr*RV*.4;
      }

      /* ─ ECHO ─ */
      if(EC>0){
        const dt   = Math.max(1, Math.min(this.dLen-1, (0.05+ET*1.9)*sampleRate|0));
        const eidx = ((this.di + this.dLen - dt) % this.dLen);
        const edl  = this.dL[eidx]; const edr = this.dR[eidx];
        const efbv = Math.min(.88, EF*.88);
        const emx  = Math.min(.75, EC*.75);
        this.dL[this.di] = L+edl*efbv; this.dR[this.di] = R+edr*efbv;
        this.di = (this.di+1)%this.dLen;
        L = L*(1-emx)+edl*emx; R = R*(1-emx)+edr*emx;
      }

      /* ─ REPEATER ─ */
      if(RE>0){
        const rav  = (Math.abs(L)+Math.abs(R))*.5;
        const hold = sampleRate*.15|0, minl=sampleRate*.1|0, gap=sampleRate|0;
        const rmix = Math.min(.92,RE*.92), reps=1+(RE*7|0);
        if(this.rs===0){ if(rav>.02){ this.rs=1; this.rpos=0; this.rsil=0; }}
        else if(this.rs===1){
          this.rbL[this.rpos]=L; this.rbR[this.rpos]=R; this.rpos++;
          if(rav>.02) this.rsil=0; else this.rsil++;
          if(this.rpos>=this.rm||(this.rsil>=hold&&this.rpos>=minl)){
            this.rl=this.rpos; this.rs=2; this.rpos=0; this.rn=reps; this.rg=gap;
          }
        } else if(this.rs===2){
          L=L*(1-rmix)+this.rbL[this.rpos]*rmix;
          R=R*(1-rmix)+this.rbR[this.rpos]*rmix;
          this.rpos++;
          if(this.rpos>=this.rl){ this.rpos=0; this.rn--; this.rs=this.rn<=0?0:3; }
        } else { this.rg--; if(this.rg<=0){ this.rg=gap; this.rs=2; } }
      } else this.rs=0;

      /* ─ FINAL MASTER OUTPUT — uncapped float gain, no limiter/compressor.
         Protect only against non-finite arithmetic so a DSP fault cannot kill
         the mic. Normal gain values are allowed to exceed ±1 intentionally. */
      L *= Gval; R *= Gval;
      o0[0][i] = isFinite(L) ? L : 0;
      if(o0[1]) o0[1][i] = isFinite(R) ? R : 0;
    }
      return true;
    } catch(e) {
      /* FALLBACK passthrough — keeps mic alive, prevents Error 3002 */
      for(let i=0;i<len;i++){
        o0[0][i]=i0[0][i]||0;
        if(o0[1])o0[1][i]=(i0[1]?i0[1][i]:i0[0][i])||0;
      }
      return true;
    }
  }
}
registerProcessor('rh-engine-v6', RHv6);`;

/* ── 4. CHAIN ─────────────────────────────────────────────
   Manages worklet lifecycle. Passthrough is always live
   before worklet is ready.
─────────────────────────────────────────────────────────── */
var CHAIN = {
  node:null, an:null, mon:null, monOn:false, postGain:null,
  _src:null, _dest:null,

  loadWorklet: function(ctx, src, dest){
    var self=this;
    this._src=src; this._dest=dest;

    var blob = new Blob([WK], {type:'application/javascript'});
    ctx.audioWorklet.addModule(URL.createObjectURL(blob)).then(function(){

      self.node = new AudioWorkletNode(ctx, 'rh-engine-v6', {
        numberOfInputs:1, numberOfOutputs:1, outputChannelCount:[2]
      });

      /* postGain is unity only. All loudness is controlled by the worklet
         master gain and five multiplying boost stages. No limiter/compressor. */
      self.postGain = ctx.createGain();
      self.postGain.gain.value = 1;

      /* Disconnect passthrough, insert worklet + postGain */
      try{ src.disconnect(dest); }catch(e){}
      src.connect(self.node);
      self.node.connect(self.postGain);
      self.postGain.connect(dest);

      /* MP3 bus — feeds into worklet so MP3 goes through same DSP chain */
      CHAIN.mp3Gain = ctx.createGain(); CHAIN.mp3Gain.gain.value = 1.0;
      CHAIN.mp3Gain.connect(self.node);

      /* Analyser for VU meter & stats */
      self.an = ctx.createAnalyser(); self.an.fftSize=512;
      self.node.connect(self.an);

      /* Monitor (headphone preview) — gain=0 by default */
      self.mon = ctx.createGain(); self.mon.gain.value=0;
      self.node.connect(self.mon); self.mon.connect(ctx.destination);

      self.update();
      /* Heartbeat — re-push all params every 2s to survive Discord context resets */
      clearInterval(self._hb);
      self._hb = setInterval(function(){ self.update(); }, 2000);

      UI.setStatus('ACTIVE','#22c55e');
      UI.setDot(true);

    }).catch(function(e){
      console.error('[RHv6] worklet failed', e);
      UI.setStatus('CHAIN ERR','#f59e0b');
    });
  },

  tryInject: function(rawStream){
    var ctx=window.DiscordContext;
    if(!ctx){ setTimeout(function(){ CHAIN.tryInject(rawStream); },300); return; }
    rawStream.getAudioTracks().forEach(function(t){ _ownMicTracks.add(t); });
    var src=ctx.createMediaStreamSource(rawStream);
    var dest=ctx.createMediaStreamDestination();
    src.connect(dest);
    this.loadWorklet(ctx, src, dest);
  },

  setMon: function(on){
    this.monOn=on;
    if(!this.mon||!window.DiscordContext) return;
    this.mon.gain.setTargetAtTime(on?.12:0, window.DiscordContext.currentTime, .05);
  },

  update: function(){
    if(!this.node||!window.DiscordContext) return;
    var p=this.node.parameters, t=window.DiscordContext.currentTime;
    function cl(v,a,b){ var n=+v; return isFinite(n)?Math.max(a,Math.min(b,n)):a; }
    function set(n,v){ var pm=p.get(n); if(pm){ pm.cancelScheduledValues(t); pm.setValueAtTime(v,t); } }

    /* Worklet master gain: 1× → 100,000,000×. Applied at final output. */
    var gainLin = S.gain<=0 ? 1 : Math.pow(10, S.gain/100*8); // 1 to 100M
    var gBoost = S.g1 * S.g2 * S.g3 * S.g4 * S.g5;
    set('gain', gainLin * gBoost);

    /* Worklet owns the master gain now. Keep the external GainNode at unity
       so there is only one authoritative gain control and no hidden cap. */
    if(this.postGain){
      var _t=window.DiscordContext.currentTime;
      this.postGain.gain.cancelScheduledValues(_t);
      this.postGain.gain.setValueAtTime(1,_t);
    }

    set('dist',    cl(S.dist,    0,  10));
    set('sat',     cl(S.sat,     0,   1));
    set('distDry', cl(S.distDry, 0,   1));
    set('presence',cl(S.presence,-6,  15));
    set('subBody', cl(S.subBody, 0,   12));
    set('exciter', cl(S.exciter, 0,   1));
    set('pit',     cl(S.pit,    -12,  12));

    for(var b=0;b<10;b++){ set('eq'+b, cl(S.eq[b],-15,15)); }

    set('robot',   cl(S.robot,   0,1)); set('tremolo', cl(S.tremolo, 0,1));
    set('stutter', cl(S.stutter, 0,1)); set('bitcrush',cl(S.bitcrush,0,1));
    set('chorus',  cl(S.chorus,  0,1)); set('flanger', cl(S.flanger, 0,1));
    set('wider',      cl(S.wider,      0,1));
    set('widerWidth', cl(S.widerWidth, 0,1));
    set('widerDist',  cl(S.widerDist,  0,10));
    set('widerSat',   cl(S.widerSat,   0,1));
    set('widerBass',  cl(S.widerBass,  0,1));
    set('widerAir',   cl(S.widerAir,   0,1));
    set('widerGain',  cl(S.widerGain,  1,20));
    set('echo',    cl(S.echo,    0,1)); set('etime',   cl(S.etime,   0,1));
    set('efb',     cl(S.efb,     0,1));
    set('reverb',  cl(S.reverb,  0,1));
    set('gate',    cl(S.gate,    0,1));
    set('bass',    cl(S.bass,    0,1)); set('air',     cl(S.air,     0,1));
    set('clean',   cl(S.clean,   0,1)); set('shout',   cl(S.shout,   0,1));
    set('chaos',   S.chaos?1:0);
    set('crush',   cl(S.crush,   0,1)); set('volt',    cl(S.volt,    0,1));
    set('rep',     cl(S.rep,     0,1));
  }
};

/* ── 4b. MP3 STATE ──────────────────────────────────────── */
var MP3 = {
  buffer:null, source:null, gainNode:null,
  playing:false, loop:true,
  startTime:0, offset:0,
  fileName:'No file loaded', volume:1.0
};

/* ── 5. PRESETS ─────────────────────────────────────────── */
var PRESETS = [
  { name:'Clean', icon:'✨',
    s:{ gain:0, dist:0, sat:0, presence:3, exciter:0.1, subBody:2, chaos:false,
        reverb:0, echo:0, comp:0.1, pit:0 } },
  { name:'Bloody Core', icon:'🩸',
    s:{ gain:72, dist:3, sat:0.6, presence:8, exciter:0.5, subBody:5, chaos:false,
        reverb:0.1, echo:0, comp:0.2, pit:0 } },
  { name:'God Mic', icon:'🔥',
    s:{ gain:80, dist:4, sat:0.7, presence:10, exciter:0.6, subBody:6, chaos:false,
        reverb:0.1, echo:0, comp:0.2, pit:0 } },
  { name:'Demon', icon:'😈',
    s:{ gain:65, dist:2, sat:0.5, presence:3, exciter:0.3, subBody:6, chaos:false,
        reverb:0.4, echo:0.2, etime:0.4, efb:0.4, comp:0.2, pit:-7 } },
  { name:'Radio', icon:'📻',
    s:{ gain:57, dist:1.5, sat:0.25, presence:7, exciter:0.35, subBody:2, chaos:false,
        clean:0.8, reverb:0, echo:0, comp:0.3, pit:0 } },
  { name:'Chipmunk', icon:'🐿️',
    s:{ gain:52, dist:0.5, sat:0.15, presence:5, exciter:0.3, subBody:1, chaos:false,
        reverb:0.1, echo:0, comp:0.2, pit:7 } },
  { name:'CHAOS MAX', icon:'💥',
    s:{ gain:100, dist:5, sat:0.85, presence:15, exciter:1, subBody:12, chaos:true,
        reverb:0.3, echo:0.2, comp:0, pit:0 } },
];

/* ── 5b. VOICE PRESETS (52 effects — pitch-primary, clarity-first) ──────────
   Rules: robot max 0.2 (higher destroys speech), reverb max 0.15 for chars,
   one primary effect per voice, pitch is the main character driver.
──────────────────────────────────────────────────────────────────────────── */
var VP = [
  /* PITCH — pure pitch, zero processing */
  {g:'Pitch',  n:'Chipmunk',   i:'🐿', s:{pit:12,  robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'+8 Semi',    i:'⬆',  s:{pit:8,   robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'+5 Semi',    i:'🔺', s:{pit:5,   robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'+3 Semi',    i:'↑',  s:{pit:3,   robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'Normal',     i:'👤', s:{pit:0,   robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'-3 Semi',    i:'↓',  s:{pit:-3,  robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'-5 Semi',    i:'🔻', s:{pit:-5,  robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'-8 Semi',    i:'⬇',  s:{pit:-8,  robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'Deep Voice', i:'🎙', s:{pit:-10, robot:0,    reverb:0.08, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Pitch',  n:'Ultra Deep', i:'🔊', s:{pit:-12, robot:0,    reverb:0.1,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  /* CHARACTERS — pitch-driven, robot max 0.2 so speech stays clear */
  {g:'Chars',  n:'Robot',      i:'🤖', s:{pit:0,   robot:0.18, reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Soft Robot', i:'🦾', s:{pit:2,   robot:0.12, reverb:0.05, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Alien',      i:'👽', s:{pit:5,   robot:0.15, reverb:0.08, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Demon',      i:'😈', s:{pit:-7,  robot:0,    reverb:0.1,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Angel',      i:'😇', s:{pit:5,   robot:0,    reverb:0.12, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Baby',       i:'👶', s:{pit:12,  robot:0,    reverb:0.06, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Monster',    i:'👹', s:{pit:-5,  robot:0,    reverb:0.1,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Ghost',      i:'👻', s:{pit:2,   robot:0,    reverb:0.15, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Witch',      i:'🧙', s:{pit:-3,  robot:0,    reverb:0.1,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Elf',        i:'🧝', s:{pit:7,   robot:0,    reverb:0.06, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Troll',      i:'🧌', s:{pit:-6,  robot:0,    reverb:0.08, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Fairy',      i:'🧚', s:{pit:10,  robot:0,    reverb:0.1,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Chars',  n:'Villain',    i:'🦹', s:{pit:-4,  robot:0,    reverb:0.1,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  /* ENVIRONMENT — reverb/echo only, speech stays clear */
  {g:'Enviro', n:'Cave',       i:'🦇', s:{pit:0,   robot:0,    reverb:0.85, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.4, etime:0.65,efb:0.6, bass:0, air:0}},
  {g:'Enviro', n:'Church',     i:'⛪', s:{pit:0,   robot:0,    reverb:0.9,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.3, etime:0.4, efb:0.45,bass:0, air:0}},
  {g:'Enviro', n:'Stadium',    i:'🏟', s:{pit:0,   robot:0,    reverb:1,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.5, etime:0.8, efb:0.65,bass:0, air:0}},
  {g:'Enviro', n:'Bathroom',   i:'🚿', s:{pit:0,   robot:0,    reverb:0.55, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.15,etime:0.1, efb:0.25,bass:0, air:0}},
  {g:'Enviro', n:'Small Room', i:'🏠', s:{pit:0,   robot:0,    reverb:0.3,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Enviro', n:'Radio',      i:'📻', s:{pit:0,   robot:0,    reverb:0,    chorus:0,    dist:0.6,tremolo:0,   flanger:0,   bitcrush:0.15, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Enviro', n:'Megaphone',  i:'📢', s:{pit:0,   robot:0,    reverb:0,    chorus:0,    dist:0.8,tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0, shout:0.4}},
  {g:'Enviro', n:'Walkie',     i:'📡', s:{pit:0,   robot:0,    reverb:0,    chorus:0,    dist:0.5,tremolo:0,   flanger:0,   bitcrush:0.2,  stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Enviro', n:'Phone',      i:'📞', s:{pit:0,   robot:0,    reverb:0,    chorus:0,    dist:0.3,tremolo:0,   flanger:0,   bitcrush:0.1,  stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Enviro', n:'Underwater', i:'🌊', s:{pit:-1,  robot:0,    reverb:0.4,  chorus:0,    dist:0,  tremolo:0,   flanger:0.35,bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Enviro', n:'Forest',     i:'🌲', s:{pit:0,   robot:0,    reverb:0.45, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.2, etime:0.6, efb:0.3, bass:0, air:0}},
  /* FX — single effect, moderate amount */
  {g:'FX',     n:'Chorus',     i:'🎶', s:{pit:0,   robot:0,    reverb:0.08, chorus:0.6,  dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'FX',     n:'Flanger',    i:'🌀', s:{pit:0,   robot:0,    reverb:0.05, chorus:0,    dist:0,  tremolo:0,   flanger:0.6, bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'FX',     n:'Tremolo',    i:'〰', s:{pit:0,   robot:0,    reverb:0.05, chorus:0,    dist:0,  tremolo:0.7, flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'FX',     n:'8-Bit',      i:'🕹', s:{pit:0,   robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0.65, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'FX',     n:'4-Bit',      i:'👾', s:{pit:0,   robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0.85, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'FX',     n:'Echo Room',  i:'🔁', s:{pit:0,   robot:0,    reverb:0.2,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.5, etime:0.4, efb:0.4, bass:0, air:0}},
  {g:'FX',     n:'Deep Echo',  i:'📣', s:{pit:0,   robot:0,    reverb:0.3,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.6, etime:0.7, efb:0.55,bass:0, air:0}},
  {g:'FX',     n:'Hi+Verb',    i:'🎤', s:{pit:3,   robot:0,    reverb:0.25, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'FX',     n:'Low+Verb',   i:'🎚', s:{pit:-4,  robot:0,    reverb:0.3,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'FX',     n:'Glitch',     i:'⚡', s:{pit:0,   robot:0,    reverb:0,    chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0.5,  stutter:0.3,echo:0,  etime:0.5, efb:0,   bass:0, air:0}},
  /* LEGENDS — pitch + very light reverb, focused and clear */
  {g:'Legends',n:'Darth Vader',i:'🌑', s:{pit:-7,  robot:0.12, reverb:0.15, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Legends',n:'Optimus',    i:'🤖', s:{pit:-3,  robot:0.18, reverb:0.08, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Legends',n:'Minion',     i:'💛', s:{pit:5,   robot:0,    reverb:0.06, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Legends',n:'Dragon',     i:'🐉', s:{pit:-5,  robot:0,    reverb:0.15, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Legends',n:'Dark Lord',  i:'👿', s:{pit:-8,  robot:0.1,  reverb:0.2,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Legends',n:'Sorcerer',   i:'🧙', s:{pit:-4,  robot:0,    reverb:0.5,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.3, etime:0.55,efb:0.4, bass:0, air:0}},
  {g:'Legends',n:'Giant',      i:'🗿', s:{pit:-10, robot:0,    reverb:0.12, chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Legends',n:'Ancient God',i:'🏛', s:{pit:-6,  robot:0,    reverb:0.7,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.2, etime:0.6, efb:0.5, bass:0, air:0}},
  {g:'Legends',n:'Specter',    i:'👁', s:{pit:3,   robot:0,    reverb:0.6,  chorus:0,    dist:0,  tremolo:0,   flanger:0,   bitcrush:0,    stutter:0, echo:0.3, etime:0.5, efb:0.35,bass:0, air:0}},
  {g:'Legends',n:'CHAOS GOD',  i:'🌪', s:{pit:12,  robot:0.18, reverb:0.5,  chorus:0,    dist:1,  tremolo:0.5, flanger:0,   bitcrush:0.4,  stutter:0, echo:0.3, etime:0.5, efb:0.3, bass:0, air:0, chaos:true}},,
  /* HARMONY — musical intervals for singing/streaming */
  {g:'Harmony',n:'Oct Up',     i:'🎵', s:{pit:12, robot:0,   reverb:0.06, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Harmony',n:'Oct Down',   i:'🎶', s:{pit:-12,robot:0,   reverb:0.06, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Harmony',n:'5th Up',     i:'🎸', s:{pit:7,  robot:0,   reverb:0.05, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Harmony',n:'5th Down',   i:'🎹', s:{pit:-7, robot:0,   reverb:0.05, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Harmony',n:'4th Up',     i:'🎷', s:{pit:5,  robot:0,   reverb:0.05, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Harmony',n:'Major 3rd',  i:'🎺', s:{pit:4,  robot:0,   reverb:0.05, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Harmony',n:'Minor 3rd',  i:'🪗', s:{pit:3,  robot:0,   reverb:0.05, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Harmony',n:'2nd Up',     i:'🎻', s:{pit:2,  robot:0,   reverb:0.04, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Harmony',n:'+2 Oct',     i:'🔮', s:{pit:24, robot:0,   reverb:0.06, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  /* CINEMA — dramatic movie character voices */
  {g:'Cinema', n:'War General',i:'🎖', s:{pit:-4, robot:0,   reverb:0.2,  chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0.1, etime:0.4, efb:0.2, bass:0, air:0}},
  {g:'Cinema', n:'Old Sage',   i:'🧓', s:{pit:-2, robot:0,   reverb:0.15, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Cinema', n:'Hero',       i:'🦸', s:{pit:1,  robot:0,   reverb:0.1,  chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Cinema', n:'Villain 2',  i:'🦇', s:{pit:-6, robot:0.08,reverb:0.12, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Cinema', n:'Narrator',   i:'📖', s:{pit:-1, robot:0,   reverb:0.08, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Cinema', n:'Anime Hero', i:'⚔', s:{pit:3,  robot:0,   reverb:0.06, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Cinema', n:'Anime Villain',i:'🗡',s:{pit:-3,robot:0.1, reverb:0.08, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Cinema', n:'Spaceman',   i:'🚀', s:{pit:0,  robot:0.15,reverb:0.1,  chorus:0,   dist:0.3,tremolo:0, flanger:0,   bitcrush:0.08,stutter:0,echo:0,  etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Cinema', n:'Commander',  i:'🌌', s:{pit:-2, robot:0.1, reverb:0.06, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  /* CREATURE — animal/monster voices */
  {g:'Creature',n:'Wolf',      i:'🐺', s:{pit:-4, robot:0,   reverb:0.12, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Creature',n:'Bear',      i:'🐻', s:{pit:-8, robot:0,   reverb:0.1,  chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Creature',n:'Cat',       i:'🐱', s:{pit:5,  robot:0,   reverb:0.04, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Creature',n:'Snake',     i:'🐍', s:{pit:-2, robot:0,   reverb:0.06, chorus:0,   dist:0, tremolo:0.15,flanger:0.2, bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Creature',n:'Zombie',    i:'🧟', s:{pit:-3, robot:0,   reverb:0.2,  chorus:0,   dist:0.3,tremolo:0.2,flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Creature',n:'Vampire',   i:'🧛', s:{pit:-4, robot:0,   reverb:0.18, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Creature',n:'Werewolf',  i:'🌕', s:{pit:-6, robot:0,   reverb:0.15, chorus:0,   dist:0.2,tremolo:0, flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  /* TECH — digital / glitchy / synthetic voices */
  {g:'Tech',   n:'Synth Low',  i:'🔋', s:{pit:-4, robot:0.15,reverb:0,    chorus:0,   dist:0.4,tremolo:0, flanger:0,   bitcrush:0.1,stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Tech',   n:'Synth Hi',   i:'⚙', s:{pit:4,  robot:0.15,reverb:0,    chorus:0,   dist:0.3,tremolo:0, flanger:0,   bitcrush:0.1,stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Tech',   n:'HAL-9000',   i:'🔴', s:{pit:-1, robot:0.18,reverb:0.06, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Tech',   n:'AI Voice',   i:'🤖', s:{pit:0,  robot:0.12,reverb:0.04, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0.05,stutter:0,echo:0,  etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Tech',   n:'Glitch 2',   i:'📺', s:{pit:0,  robot:0,   reverb:0,    chorus:0,   dist:0.5,tremolo:0, flanger:0,   bitcrush:0.6,stutter:0.4,echo:0,  etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Tech',   n:'Static',     i:'📡', s:{pit:0,  robot:0,   reverb:0,    chorus:0,   dist:0.7,tremolo:0, flanger:0,   bitcrush:0.3,stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Tech',   n:'Dial-up',    i:'☎', s:{pit:0,  robot:0.08,reverb:0,    chorus:0,   dist:0.4,tremolo:0.5,flanger:0,  bitcrush:0.2,stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Tech',   n:'Cyborg',     i:'🦿', s:{pit:-2, robot:0.14,reverb:0.05, chorus:0,   dist:0.2,tremolo:0, flanger:0,   bitcrush:0.08,stutter:0,echo:0,  etime:0.5, efb:0,   bass:0, air:0}},
  /* VINTAGE — old-timey, lo-fi, vinyl */
  {g:'Vintage',n:'Vinyl',      i:'💿', s:{pit:0,  robot:0,   reverb:0.1,  chorus:0,   dist:0.2,tremolo:0.05,flanger:0.1,bitcrush:0.1,stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Vintage',n:'1920s',      i:'🎙', s:{pit:0,  robot:0,   reverb:0.15, chorus:0,   dist:0.35,tremolo:0,flanger:0.15,bitcrush:0.12,stutter:0,echo:0,  etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Vintage',n:'Cassette',   i:'📼', s:{pit:-1, robot:0,   reverb:0.08, chorus:0,   dist:0.15,tremolo:0.04,flanger:0,bitcrush:0.08,stutter:0,echo:0,  etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Vintage',n:'Gramophone', i:'🎵', s:{pit:0,  robot:0,   reverb:0.2,  chorus:0,   dist:0.4,tremolo:0.06,flanger:0.2,bitcrush:0.15,stutter:0,echo:0,  etime:0.5, efb:0,   bass:0, air:0}},
  /* SPACE — cosmic, ethereal, alien */
  {g:'Space',  n:'Nebula',     i:'🌌', s:{pit:2,  robot:0,   reverb:0.95, chorus:0.4, dist:0, tremolo:0.2,flanger:0.3, bitcrush:0, stutter:0, echo:0.5, etime:0.7, efb:0.6, bass:0, air:0}},
  {g:'Space',  n:'Black Hole', i:'🕳', s:{pit:-5, robot:0,   reverb:1,    chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0.7, etime:0.9, efb:0.7, bass:0, air:0}},
  {g:'Space',  n:'Pulsar',     i:'💫', s:{pit:0,  robot:0,   reverb:0.6,  chorus:0,   dist:0, tremolo:0.8,flanger:0.3, bitcrush:0, stutter:0, echo:0.4, etime:0.6, efb:0.5, bass:0, air:0}},
  {g:'Space',  n:'Cosmos',     i:'✨', s:{pit:3,  robot:0,   reverb:0.9,  chorus:0.5, dist:0, tremolo:0.15,flanger:0,  bitcrush:0, stutter:0, echo:0.35,etime:0.65,efb:0.45,bass:0, air:0}},
  {g:'Space',  n:'Wormhole',   i:'🌀', s:{pit:0,  robot:0.08,reverb:0.7,  chorus:0,   dist:0, tremolo:0,  flanger:0.7, bitcrush:0, stutter:0, echo:0.4, etime:0.8, efb:0.6, bass:0, air:0}},
  /* EXTREME — for maximum chaos */
  {g:'Extreme',n:'Shout Bot',  i:'📣', s:{pit:0,  robot:0.15,reverb:0,    chorus:0,   dist:0.8,tremolo:0, flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0, shout:0.6}},
  {g:'Extreme',n:'Hell Voice', i:'🔥', s:{pit:-7, robot:0.12,reverb:0.3,  chorus:0,   dist:0.9,tremolo:0, flanger:0,   bitcrush:0, stutter:0, echo:0.2, etime:0.5, efb:0.3, bass:0, air:0}},
  {g:'Extreme',n:'Scream',     i:'😱', s:{pit:3,  robot:0,   reverb:0.1,  chorus:0,   dist:0.9,tremolo:0, flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0, shout:0.8}},
  {g:'Extreme',n:'Noise',      i:'🌩', s:{pit:0,  robot:0,   reverb:0,    chorus:0,   dist:1,  tremolo:0, flanger:0,   bitcrush:0.9,stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Extreme',n:'Meltdown',   i:'☢', s:{pit:0,  robot:0.18,reverb:0.3,  chorus:0,   dist:1,  tremolo:0.4,flanger:0.4, bitcrush:0.5,stutter:0.2,echo:0.3,etime:0.5, efb:0.3, bass:0, air:0}},
  {g:'Extreme',n:'God Mode',   i:'👑', s:{pit:0,  robot:0,   reverb:0.5,  chorus:0,   dist:1,  tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0.3, etime:0.6, efb:0.4, bass:0, air:0, shout:1}},
  /* CLEAN MIX — voice + space for pro use */
  {g:'Clean',  n:'Warm',       i:'🌅', s:{pit:0,  robot:0,   reverb:0.12, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Clean',  n:'Bright',     i:'☀', s:{pit:1,  robot:0,   reverb:0.06, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Clean',  n:'Dark',       i:'🌑', s:{pit:-2, robot:0,   reverb:0.1,  chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Clean',  n:'Silky',      i:'🌸', s:{pit:0,  robot:0,   reverb:0.08, chorus:0.2, dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}},
  {g:'Clean',  n:'Podcast',    i:'🎙', s:{pit:0,  robot:0,   reverb:0.05, chorus:0,   dist:0, tremolo:0,  flanger:0,   bitcrush:0, stutter:0, echo:0,   etime:0.5, efb:0,   bass:0, air:0}}
];

function applyVoicePreset(vp){
  /* Reset ALL DSP params so no residual bleeds from previous preset */
  S.pit=0; S.robot=0; S.reverb=0; S.chorus=0; S.flanger=0; S.bitcrush=0;
  S.dist=0; S.tremolo=0; S.stutter=0; S.echo=0; S.etime=0.5; S.efb=0;
  S.shout=0; S.bass=0; S.air=0; S.chaos=false; S.comp=0; S.gate=0;
  S.g1=1; S.g2=1; S.g3=1; S.g4=1; S.g5=1;
  /* Apply preset */
  var keys=Object.keys(vp.s);
  for(var i=0;i<keys.length;i++){ S[keys[i]]=vp.s[keys[i]]; }
  CHAIN.update();
}

function applyPreset(pr){
  Object.assign(S, pr.s);
  if(pr.s.chaos) S.chaos=1; else S.chaos=0;
  CHAIN.update();
  UI.refreshSliders();
}

/* ── 6. DEVICES ─────────────────────────────────────────── */
var DEVICES=[];
function loadDevices(){
  if(!navigator.mediaDevices.enumerateDevices) return;
  navigator.mediaDevices.enumerateDevices().then(function(devs){
    DEVICES=devs.filter(function(d){ return d.kind==='audioinput'; });
    var sel=document.getElementById('rh-devsel');
    if(!sel) return;
    sel.innerHTML='';
    DEVICES.forEach(function(d,i){
      var o=document.createElement('option');
      o.value=d.deviceId;
      o.textContent=d.label||('Mic '+(i+1));
      sel.appendChild(o);
    });
  }).catch(function(){});
}

/* ── 7. VC JOIN ─────────────────────────────────────────── */
function joinVC(){
  var tries=['[class*="joinCallButton"]','[class*="joinVoice"]',
             '[class*="voiceConnect"]','[aria-label*="Join Voice"]',
             '[aria-label*="join"]','button[class*="connect"]'];
  for(var i=0;i<tries.length;i++){
    var el=document.querySelector(tries[i]);
    if(el){ el.click(); return true; }
  }
  return false;
}

/* ── 8. FORMATTERS ──────────────────────────────────────── */
function fmtGain(v){
  if(v<=0) return '1×';
  var x=Math.pow(10, v/100*8);
  if(x<1e3)  return x.toFixed(0)+'×';
  if(x<1e6)  return (x/1e3).toFixed(1)+'K×';
  if(x<1e9)  return (x/1e6).toFixed(1)+'M×';
  return (x/1e9).toFixed(2)+'B×';
}
function fmtPct(v){ return Math.round(v*100)+'%'; }
function fmtDb(v){ return isFinite(v) ? v.toFixed(1)+'dB' : '-∞ dB'; }
function fmtTime(ms){
  var s=Math.floor(ms/1000); var m=Math.floor(s/60); s=s%60;
  return m+'m '+s.toString().padStart(2,'0')+'s';
}

/* ── 9. CSS ─────────────────────────────────────────────── */
var CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap');

#rh{all:initial;display:block;position:fixed;top:14px;left:14px;z-index:2147483647;
  width:352px;font-family:'Inter',system-ui,sans-serif;font-size:13px;color:#e2e8f0;
  background:#0e0b1c;border:1px solid rgba(139,92,246,.28);border-radius:16px;
  box-shadow:0 0 0 1px rgba(255,255,255,.04) inset,0 32px 80px rgba(0,0,0,.92),0 0 48px rgba(109,40,217,.12);
  overflow:hidden;}
#rh *{box-sizing:border-box;font-family:inherit;}

/* HEADER */
.H{display:flex;align-items:center;justify-content:space-between;
  padding:10px 12px 9px;cursor:move;user-select:none;
  border-bottom:1px solid rgba(255,255,255,.06);
  background:linear-gradient(180deg,rgba(109,40,217,.2) 0%,transparent 100%);}
.H-logo{font-size:13px;font-weight:700;color:#fff;}
.H-logo em{color:#a78bfa;font-style:normal;}
.H-ver{font-family:'JetBrains Mono',monospace;font-size:9px;padding:1px 6px;
  border-radius:20px;margin-left:6px;
  background:rgba(139,92,246,.15);border:1px solid rgba(139,92,246,.25);color:#8b5cf6;}
.H-r{display:flex;align-items:center;gap:4px;}
.H-dot{width:8px;height:8px;border-radius:50%;background:#f59e0b;transition:background .3s;flex-shrink:0;margin-right:2px;}
.H-dot.live{background:#22c55e;box-shadow:0 0 6px #22c55e;}
.H-st{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.3px;
  padding:3px 8px;border-radius:20px;
  background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.08);color:#f59e0b;}
.H-btn{width:26px;height:24px;border-radius:6px;cursor:pointer;
  border:1px solid rgba(255,255,255,.08);
  background:rgba(255,255,255,.05);color:rgba(255,255,255,.65);
  font-size:11px;display:flex;align-items:center;justify-content:center;}
.H-btn:hover{background:rgba(255,255,255,.11);}
.H-btn.on{background:rgba(139,92,246,.22);border-color:rgba(139,92,246,.4);color:#c4b5fd;}

/* VC + DEVICE */
.VC{display:flex;align-items:center;gap:7px;padding:5px 12px;
  border-bottom:1px solid rgba(255,255,255,.06);background:rgba(88,101,242,.07);}
.VC-lbl{font-size:10px;color:rgba(255,255,255,.4);flex:1;}
.VC-btn{padding:3px 10px;border-radius:6px;font-size:10px;font-weight:600;
  cursor:pointer;border:1px solid rgba(88,101,242,.45);
  background:rgba(88,101,242,.18);color:#818cf8;}
.VC-btn:hover{background:rgba(88,101,242,.32);}
.DEV{padding:5px 12px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;gap:5px;align-items:center;}
.DEV-lbl{font-size:9px;color:rgba(255,255,255,.32);white-space:nowrap;}
#rh-devsel{flex:1;padding:3px 6px;border-radius:7px;font-size:10px;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  color:#e2e8f0;outline:none;cursor:pointer;}
#rh-devsel option{background:#1a1530;color:#e2e8f0;}
.DEV-btn{padding:3px 9px;border-radius:7px;font-size:10px;font-weight:600;
  cursor:pointer;white-space:nowrap;
  border:1px solid rgba(139,92,246,.38);background:rgba(139,92,246,.14);color:#a78bfa;}
.DEV-btn:hover{background:rgba(139,92,246,.26);}

/* VU METER */
.MT{margin:5px 12px 0;height:3px;border-radius:3px;background:rgba(255,255,255,.06);}
.MT-f{height:100%;width:0%;border-radius:3px;
  background:linear-gradient(90deg,#6d28d9,#8b5cf6,#06b6d4,#22c55e,#f59e0b,#f43f5e);
  transition:width .05s linear;}

/* TABS — scrollable row */
.T{display:flex;gap:2px;padding:7px 9px 0;overflow-x:auto;scrollbar-width:none;}
.T::-webkit-scrollbar{display:none;}
.T-tab{flex-shrink:0;padding:4px 8px;font-size:9.5px;font-weight:600;
  border-radius:7px;border:1px solid rgba(255,255,255,.07);
  background:transparent;color:rgba(255,255,255,.33);cursor:pointer;text-align:center;white-space:nowrap;}
.T-tab:hover{color:rgba(255,255,255,.65);}
.T-tab.on{background:rgba(139,92,246,.18);border-color:rgba(139,92,246,.32);color:#ddd6fe;}

/* BODY */
.B{padding:5px 9px 9px;max-height:380px;overflow-y:auto;overflow-x:hidden;}
.B::-webkit-scrollbar{width:3px;}
.B::-webkit-scrollbar-thumb{background:rgba(139,92,246,.22);border-radius:3px;}
.P{display:none;}.P.on{display:block;}

/* CARD */
.C{margin-bottom:4px;padding:8px 10px 7px;border-radius:10px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);}
.C-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;}
.C-lbl{font-size:11px;font-weight:500;color:rgba(255,255,255,.8);}
.C-val{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:500;
  color:#a78bfa;padding:2px 7px;border-radius:4px;min-width:52px;text-align:center;
  background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.18);cursor:text;}
.C-val:hover{background:rgba(139,92,246,.2);border-color:rgba(139,92,246,.35);}
.C-hint{font-size:9px;color:rgba(255,255,255,.24);margin-top:3px;line-height:1.4;}

/* SLIDER */
input[type=range]{-webkit-appearance:none;appearance:none;
  width:100%;height:4px;border-radius:3px;
  background:rgba(255,255,255,.1);outline:none;cursor:pointer;display:block;}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;
  background:#c4b5fd;border:2px solid #7c3aed;
  box-shadow:0 0 0 3px rgba(124,58,237,.18);cursor:pointer;}

/* EQ grid (vertical sliders) */
.EQ-grid{display:flex;gap:4px;align-items:flex-end;padding:4px 2px;}
.EQ-col{display:flex;flex-direction:column;align-items:center;gap:3px;flex:1;}
.EQ-val{font-family:'JetBrains Mono',monospace;font-size:8px;color:#a78bfa;text-align:center;min-width:24px;}
.EQ-col input[type=range]{writing-mode:vertical-lr;direction:rtl;
  -webkit-appearance:slider-vertical;appearance:slider-vertical;
  width:4px;height:80px;cursor:pointer;background:rgba(255,255,255,.1);}
.EQ-col input[type=range]::-webkit-slider-thumb{width:12px;height:12px;}
.EQ-lbl{font-size:8px;color:rgba(255,255,255,.35);text-align:center;}

/* FX GRID */
.FX-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;}
.FX-cell{padding:8px 4px;border-radius:8px;text-align:center;cursor:pointer;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);
  transition:all .15s;}
.FX-cell:hover{background:rgba(255,255,255,.07);}
.FX-cell.on{background:rgba(139,92,246,.2);border-color:rgba(139,92,246,.5);}
.FX-icon{font-size:16px;margin-bottom:2px;}
.FX-name{font-size:9px;color:rgba(255,255,255,.55);}
.FX-cell.on .FX-name{color:#ddd6fe;}

/* POWER GRID */
.PW-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;}
.PW-btn{padding:12px 8px;border-radius:10px;text-align:center;cursor:pointer;
  border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);transition:all .2s;}
.PW-btn:hover{background:rgba(255,255,255,.08);}
.PW-btn.on{background:rgba(139,92,246,.2);border-color:rgba(139,92,246,.5);}
.PW-icon{font-size:20px;margin-bottom:4px;}
.PW-lbl{font-size:11px;font-weight:600;color:rgba(255,255,255,.8);}
.PW-sub{font-size:9px;color:rgba(255,255,255,.35);margin-top:2px;}
.CHAOS-btn{grid-column:1/-1;border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.08);}
.CHAOS-btn.on{background:rgba(239,68,68,.25);border-color:rgba(239,68,68,.7);
  animation:chp .9s ease-in-out infinite alternate;}
@keyframes chp{from{box-shadow:0 0 8px rgba(239,68,68,.4)}to{box-shadow:0 0 24px rgba(239,68,68,.8)}}

/* PRESETS */
.VP-grp-lbl{font-size:10px;font-weight:700;color:rgba(139,92,246,.7);letter-spacing:.08em;margin:8px 0 4px;text-transform:uppercase;}
.VP-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:4px;}
.VP-btn{padding:6px 2px;border-radius:8px;text-align:center;cursor:pointer;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);transition:all .15s;}
.VP-btn:hover{background:rgba(139,92,246,.12);border-color:rgba(139,92,246,.3);}
.VP-btn.on{background:rgba(139,92,246,.25);border-color:rgba(139,92,246,.6);}
.VP-icon{font-size:14px;margin-bottom:2px;}
.VP-nm{font-size:8px;color:rgba(255,255,255,.55);line-height:1.2;}
.VP-btn.on .VP-nm{color:#ddd6fe;}
.PR-list{display:flex;flex-direction:column;gap:3px;}
.PR-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);cursor:pointer;
  transition:background .15s;}
.PR-row:hover{background:rgba(139,92,246,.1);border-color:rgba(139,92,246,.25);}
.PR-icon{font-size:16px;}
.PR-name{font-size:12px;font-weight:600;color:rgba(255,255,255,.85);flex:1;}
.PR-arr{color:rgba(139,92,246,.6);font-size:14px;}

/* STATS */
.ST-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;}
.ST-card{padding:10px;border-radius:8px;background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.08);text-align:center;}
.ST-lbl{font-size:9px;color:rgba(255,255,255,.4);margin-bottom:4px;}
.ST-val{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;color:#a78bfa;}

/* SECTION TITLE */
.S-ttl{font-size:10px;font-weight:600;color:rgba(255,255,255,.35);
  text-transform:uppercase;letter-spacing:.8px;margin:8px 0 5px;padding-left:2px;}

/* TOGGLE ROW */
.TG-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;
  border-radius:8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);
  margin-bottom:4px;cursor:pointer;}
.TG-lbl{font-size:11px;font-weight:500;color:rgba(255,255,255,.75);}
.TG-switch{width:32px;height:18px;border-radius:9px;background:rgba(255,255,255,.12);
  position:relative;transition:background .2s;flex-shrink:0;}
.TG-switch::after{content:'';position:absolute;top:3px;left:3px;width:12px;height:12px;
  border-radius:50%;background:#fff;opacity:.5;transition:all .2s;}
.TG-row.on .TG-switch{background:rgba(139,92,246,.6);}
.TG-row.on .TG-switch::after{left:17px;opacity:1;}

/* RESET */
.RST{width:100%;margin-top:6px;padding:7px;border-radius:8px;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);
  color:rgba(255,255,255,.5);font-weight:600;font-size:11px;cursor:pointer;}
.RST:hover{background:rgba(255,255,255,.09);}

/* COLLAPSED */
.rh-coll .T,.rh-coll .MT,.rh-coll .B,.rh-coll .VC,.rh-coll .DEV{display:none;}

/* MP3 PLAYER */
.MP-drop{border:2px dashed rgba(139,92,246,.3);border-radius:10px;padding:12px;text-align:center;
  cursor:pointer;margin-bottom:7px;transition:border-color .2s,background .2s;}
.MP-drop:hover,.MP-drop.dragover{border-color:rgba(139,92,246,.7);background:rgba(139,92,246,.06);}
.MP-drop-icon{font-size:22px;margin-bottom:3px;}
.MP-drop-lbl{font-size:9px;color:rgba(255,255,255,.35);line-height:1.5;}
.MP-name{font-size:10px;color:#a78bfa;padding:3px 0;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;margin-bottom:4px;transition:color .3s;}
.MP-wave{display:flex;align-items:flex-end;gap:2px;height:26px;margin-bottom:5px;
  padding:0 2px;}
.MP-wbar{flex:1;background:rgba(139,92,246,.28);border-radius:1px;min-height:3px;
  transition:height .3s,background .3s;}
.MP-prog{height:4px;border-radius:3px;background:rgba(255,255,255,.08);cursor:pointer;
  position:relative;margin-bottom:3px;}
.MP-progf{height:100%;border-radius:3px;
  background:linear-gradient(90deg,#7c3aed,#c4b5fd);width:0%;transition:width .12s;}
.MP-time{font-family:'JetBrains Mono',monospace;font-size:9px;
  color:rgba(255,255,255,.28);text-align:right;margin-bottom:6px;}
.MP-ctl{display:flex;gap:5px;justify-content:center;margin-bottom:8px;}
.MP-btn{width:38px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.1);
  background:rgba(255,255,255,.05);color:rgba(255,255,255,.6);font-size:14px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;transition:all .15s;}
.MP-btn:hover{background:rgba(139,92,246,.2);border-color:rgba(139,92,246,.4);}
.MP-btn.lp-on{color:#a78bfa;border-color:rgba(139,92,246,.35);}
.MP-btn.pl-on{background:rgba(139,92,246,.22);border-color:rgba(139,92,246,.5);}

/* RESCUE OVERLAY */
#rh-rescue{position:fixed;inset:0;background:rgba(0,0,0,.88);
  z-index:2147483646;display:none;align-items:center;justify-content:center;}
.RB{padding:18px 28px;border-radius:14px;color:#fff;
  font-size:14px;font-weight:700;cursor:pointer;text-align:center;
  background:linear-gradient(135deg,#6d28d9,#4c1d95);
  box-shadow:0 0 60px rgba(109,40,217,.7),0 20px 50px rgba(0,0,0,.6);
  animation:rhp .8s ease-in-out infinite alternate;}
@keyframes rhp{from{transform:scale(1)}to{transform:scale(1.05)}}
`;

/* ── 10. UI ─────────────────────────────────────────────── */
var UI = {
  _tab: 'main',
  _sliders: [],

  setStatus: function(t,c){
    var e=document.getElementById('rh-st');
    if(e){ e.textContent=t; e.style.color=c||''; }
  },

  setDot: function(active){
    var d=document.getElementById('rh-dot');
    if(d) d.classList.toggle('live', active);
  },

  refreshSliders: function(){
    /* Re-sync all slider values to current S state */
    function setEl(id, v){ var e=document.getElementById(id); if(e) e.value=v; }
    function setTxt(id, t){ var e=document.getElementById(id); if(e) e.textContent=t; }

    setEl('sl-gain', S.gain);    setTxt('v-gain', fmtGain(S.gain));
    setEl('sl-g1', S.g1); setTxt('v-g1', S.g1.toFixed(1)+'×');
    setEl('sl-g2', S.g2); setTxt('v-g2', S.g2.toFixed(1)+'×');
    setEl('sl-g3', S.g3); setTxt('v-g3', S.g3.toFixed(1)+'×');
    setEl('sl-g4', S.g4); setTxt('v-g4', S.g4.toFixed(1)+'×');
    setEl('sl-g5', S.g5); setTxt('v-g5', S.g5.toFixed(1)+'×');
    setEl('sl-clean', S.clean*100); setTxt('v-clean', Math.round(S.clean*100)+'%');
    setEl('sl-bass', S.bass*100);   setTxt('v-bass',  Math.round(S.bass*100)+'%');
    setEl('sl-air', S.air*100);     setTxt('v-air',   Math.round(S.air*100)+'%');
    setEl('sl-gate', S.gate*100);   setTxt('v-gate',  Math.round(S.gate*100)+'%');
    setEl('sl-dist', S.dist*100);   setTxt('v-dist',  Math.round(S.dist*100)+'%');  // 0-10 → slider 0-1000
    setEl('sl-sat', S.sat*100);     setTxt('v-sat',   Math.round(S.sat*100)+'%');
    setEl('sl-distDry', S.distDry*100); setTxt('v-distDry', Math.round(S.distDry*100)+'%');
    setEl('sl-shout', S.shout*100); setTxt('v-shout', Math.round(S.shout*100)+'%');
    setEl('sl-crush', S.crush*100); setTxt('v-crush', Math.round(S.crush*100)+'%');
    setEl('sl-bitcrush', S.bitcrush*100); setTxt('v-bitcrush', Math.round(S.bitcrush*100)+'%');
    setEl('sl-volt', S.volt*100);   setTxt('v-volt',  Math.round(S.volt*100)+'%');
    setEl('sl-rep', S.rep*100);     setTxt('v-rep',   Math.round(S.rep*100)+'%');
    setEl('sl-presence', S.presence);
    var pre=document.getElementById('v-presence'); if(pre) pre.textContent=(S.presence>0?'+':'')+S.presence+'dB';
    setEl('sl-subBody', S.subBody);
    setTxt('v-subBody', '+'+S.subBody+'dB');
    setEl('sl-exciter', S.exciter*100); setTxt('v-exciter', Math.round(S.exciter*100)+'%');
    var psl=document.getElementById('sl-pit'); if(psl) psl.value=((S.pit/12)*50)+50;
    setTxt('v-pit', (S.pit>0?'+':'')+S.pit+'st');
    setEl('sl-reverb', S.reverb*100);  setTxt('v-reverb', Math.round(S.reverb*100)+'%');
    setEl('sl-echo', S.echo*100);      setTxt('v-echo', Math.round(S.echo*100)+'%');
    setEl('sl-etime', S.etime*100);    setTxt('v-etime', Math.round(S.etime*100)+'%');
    setEl('sl-efb', S.efb*100);        setTxt('v-efb', Math.round(S.efb*100)+'%');
    setEl('sl-wider', S.wider*100);    setTxt('v-wider', Math.round(S.wider*100)+'%');
    setEl('sl-widerWidth', S.widerWidth*100); setTxt('v-widerWidth', Math.round(S.widerWidth*100)+'%');
    setEl('sl-widerDist',  S.widerDist*100);  setTxt('v-widerDist',  Math.round(S.widerDist*100)+'%');
    setEl('sl-widerSat',   S.widerSat*100);   setTxt('v-widerSat',   Math.round(S.widerSat*100)+'%');
    setEl('sl-widerBass',  S.widerBass*100);  setTxt('v-widerBass',  Math.round(S.widerBass*100)+'%');
    setEl('sl-widerAir',   S.widerAir*100);   setTxt('v-widerAir',   Math.round(S.widerAir*100)+'%');
    setEl('sl-widerGain',  S.widerGain);      setTxt('v-widerGain',  S.widerGain.toFixed(1)+'×');
    setEl('sl-chorus', S.chorus*100);  setTxt('v-chorus', Math.round(S.chorus*100)+'%');
    setEl('sl-flanger', S.flanger*100);setTxt('v-flanger', Math.round(S.flanger*100)+'%');
    for(var b=0;b<10;b++){
      var es=document.getElementById('sl-eq'+b); if(es) es.value=S.eq[b];
      var ev=document.getElementById('v-eq'+b);
      if(ev) ev.textContent=(S.eq[b]>0?'+':'')+S.eq[b];
    }
  },

  init: function(){
    var st=document.createElement('style');
    st.textContent=CSS;
    document.head.appendChild(st);

    var EQ_LABELS=['60','150','400','1k','2.4k','6k','12k','16k','Bass','Tre'];

    var w=document.createElement('div'); w.id='rh';

    var eqCols='';
    for(var b=0;b<10;b++){
      eqCols+=
        '<div class="EQ-col">'+
          '<div class="EQ-val" id="v-eq'+b+'">0</div>'+
          '<input type="range" id="sl-eq'+b+'" min="-15" max="15" step="0.5" value="0" orient="vertical">'+
          '<div class="EQ-lbl">'+EQ_LABELS[b]+'</div>'+
        '</div>';
    }

    var fxItems=[
      {id:'robot',   icon:'🤖', name:'Robot'},
      {id:'tremolo', icon:'〰',  name:'Tremolo'},
      {id:'stutter', icon:'✂',  name:'Stutter'},
      {id:'bitcrush',icon:'💀', name:'Crush'},
      {id:'chorus',  icon:'🎵', name:'Chorus'},
      {id:'flanger', icon:'🌀', name:'Flanger'},
    ];
    var fxCells='';
    fxItems.forEach(function(fx){
      fxCells+='<div class="FX-cell" data-fx="'+fx.id+'"><div class="FX-icon">'+fx.icon+'</div><div class="FX-name">'+fx.name+'</div></div>';
    });

    var prRows='';
    PRESETS.forEach(function(pr,i){
      prRows+='<div class="PR-row" data-preset="'+i+'"><div class="PR-icon">'+pr.icon+'</div><div class="PR-name">'+pr.name+'</div><div class="PR-arr">›</div></div>';
    });

    w.innerHTML=
      /* HEADER */
      '<div class="H" id="rh-hd">'+
        '<span class="H-logo">Rexx\'s <em>Hook</em><span class="H-ver">v6</span></span>'+
        '<div class="H-r">'+
          '<div class="H-dot" id="rh-dot"></div>'+
          '<span id="rh-st" class="H-st">WAITING</span>'+
          '<button id="rh-mon" class="H-btn" title="Monitor headphones">🎧</button>'+
          '<button id="rh-col" class="H-btn">▾</button>'+
        '</div>'+
      '</div>'+

      /* VC + DEVICE */
      '<div class="VC">'+
        '<span class="VC-lbl">🎙 Voice Channel</span>'+
        '<button id="rh-vc" class="VC-btn">Join VC ▶</button>'+
      '</div>'+
      '<div class="DEV">'+
        '<span class="DEV-lbl">MIC:</span>'+
        '<select id="rh-devsel"><option value="">Default</option></select>'+
        '<button id="rh-devapply" class="DEV-btn">Apply</button>'+
      '</div>'+

      /* TABS */
      '<div class="T">'+
        '<button class="T-tab on" data-tab="main">Main</button>'+
        '<button class="T-tab" data-tab="dist">Distort</button>'+
        '<button class="T-tab" data-tab="psycho">Psycho</button>'+
        '<button class="T-tab" data-tab="eq">EQ</button>'+
        '<button class="T-tab" data-tab="space">Space</button>'+
        '<button class="T-tab" data-tab="fx">FX</button>'+
        '<button class="T-tab" data-tab="power">Power</button>'+
        '<button class="T-tab" data-tab="presets">Presets</button>'+
        '<button class="T-tab" data-tab="stats">Stats</button>'+
        '<button class="T-tab" data-tab="mp3">🎵 MP3</button>'+
        '<button class="T-tab" data-tab="voice">🎤 Voice</button>'+
      '</div>'+

      /* VU METER */
      '<div class="MT"><div class="MT-f" id="rh-mf"></div></div>'+

      /* BODY */
      '<div class="B">'+

      /* ═══ MAIN ═══ */
      '<div class="P on" data-pane="main">'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔥 Gain</span><span class="C-val" id="v-gain">1×</span></div>'+
          '<input type="range" id="sl-gain" min="0" max="100" value="0" step="0.1">'+
          '<div class="C-hint">log scale: 0=1× · 50=10K× · 100=100M× · no limiter</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">✨ Clean Voice</span><span class="C-val" id="v-clean">0%</span></div>'+
          '<input type="range" id="sl-clean" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔊 Bass</span><span class="C-val" id="v-bass">0%</span></div>'+
          '<input type="range" id="sl-bass" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">💨 Air</span><span class="C-val" id="v-air">0%</span></div>'+
          '<input type="range" id="sl-air" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔥 Boost 1</span><span class="C-val" id="v-g1">1.0×</span></div>'+
          '<input type="range" id="sl-g1" min="1" max="10" value="1" step="0.1"><div class="C-hint">×10 gain stage — stacks with others</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">⚡ Boost 2</span><span class="C-val" id="v-g2">1.0×</span></div>'+
          '<input type="range" id="sl-g2" min="1" max="20" value="1" step="0.1"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">💥 Boost 3</span><span class="C-val" id="v-g3">1.0×</span></div>'+
          '<input type="range" id="sl-g3" min="1" max="40" value="1" step="0.1"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔊 Boost 4</span><span class="C-val" id="v-g4">1.0×</span></div>'+
          '<input type="range" id="sl-g4" min="1" max="80" value="1" step="0.1"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🎯 Boost 5</span><span class="C-val" id="v-g5">1.0×</span></div>'+
          '<input type="range" id="sl-g5" min="1" max="160" value="1" step="0.1"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🚪 Noise Gate</span><span class="C-val" id="v-gate">0%</span></div>'+
          '<input type="range" id="sl-gate" min="0" max="100" value="0"></div>'+
        '<button class="RST" id="rh-rst">⟳ Reset All</button>'+
      '</div>'+

      /* ═══ DISTORT ═══ */
      '<div class="P" data-pane="dist">'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔴 Distortion</span><span class="C-val" id="v-dist">0%</span></div>'+
          '<input type="range" id="sl-dist" min="0" max="1000" value="0" step="1">'+
          '<div class="C-hint">0%=clean · 100%=overdrive · 500%=brutal · 1000%=MAX chaos square-wave · NO limiter</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🌡 Saturation</span><span class="C-val" id="v-sat">0%</span></div>'+
          '<input type="range" id="sl-sat" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🌊 Dry Mix</span><span class="C-val" id="v-distDry">20%</span></div>'+
          '<input type="range" id="sl-distDry" min="0" max="100" value="20">'+
          '<div class="C-hint">clean blend with distorted</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">😤 Shout</span><span class="C-val" id="v-shout">0%</span></div>'+
          '<input type="range" id="sl-shout" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">💥 Sample Crush</span><span class="C-val" id="v-crush">0%</span></div>'+
          '<input type="range" id="sl-crush" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">⚡ BitCrush</span><span class="C-val" id="v-bitcrush">0%</span></div>'+
          '<input type="range" id="sl-bitcrush" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔌 DC Bias</span><span class="C-val" id="v-volt">0%</span></div>'+
          '<input type="range" id="sl-volt" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔁 Repeater</span><span class="C-val" id="v-rep">0%</span></div>'+
          '<input type="range" id="sl-rep" min="0" max="100" value="0"></div>'+
      '</div>'+

      /* ═══ PSYCHO ═══ */
      '<div class="P" data-pane="psycho">'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🎯 Presence (+dB @ 2.5kHz)</span><span class="C-val" id="v-presence">0dB</span></div>'+
          '<input type="range" id="sl-presence" min="-6" max="15" value="0" step="0.5">'+
          '<div class="C-hint">ear\'s most sensitive region — cuts through mix</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">✨ Harmonic Exciter</span><span class="C-val" id="v-exciter">0%</span></div>'+
          '<input type="range" id="sl-exciter" min="0" max="100" value="0">'+
          '<div class="C-hint">HPF → tanh harmonics above 4kHz — psychoacoustic loudness</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🏋 Sub Body (+dB @ 80Hz)</span><span class="C-val" id="v-subBody">0dB</span></div>'+
          '<input type="range" id="sl-subBody" min="0" max="12" value="0" step="0.5">'+
          '<div class="C-hint">sub-bass shelf — physical weight and presence</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🎵 Pitch Shift</span><span class="C-val" id="v-pit">0st</span></div>'+
          '<input type="range" id="sl-pit" min="0" max="100" value="50">'+
          '<div class="C-hint">center=0 · left=−12st · right=+12st</div></div>'+
      '</div>'+

      /* ═══ EQ ═══ */
      '<div class="P" data-pane="eq">'+
        '<div class="C-hint" style="margin-bottom:4px">10-band EQ · −15 to +15 dB</div>'+
        '<div class="C"><div class="EQ-grid">'+eqCols+'</div></div>'+
        '<button class="RST" id="rh-eq-flat">♭ Flatten EQ</button>'+
      '</div>'+

      /* ═══ SPACE ═══ */
      '<div class="P" data-pane="space">'+
        '<div class="S-ttl">Reverb</div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🏠 Reverb Mix</span><span class="C-val" id="v-reverb">0%</span></div>'+
          '<input type="range" id="sl-reverb" min="0" max="100" value="0"></div>'+
        '<div class="S-ttl">Echo</div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔈 Echo Mix</span><span class="C-val" id="v-echo">0%</span></div>'+
          '<input type="range" id="sl-echo" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">⏱ Echo Time</span><span class="C-val" id="v-etime">50%</span></div>'+
          '<input type="range" id="sl-etime" min="0" max="100" value="50"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">♻ Echo Feedback</span><span class="C-val" id="v-efb">0%</span></div>'+
          '<input type="range" id="sl-efb" min="0" max="100" value="0"></div>'+
        '<div class="S-ttl">Stereo Wider</div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">↔ Width</span><span class="C-val" id="v-widerWidth">0%</span></div>'+
          '<input type="range" id="sl-widerWidth" min="0" max="100" value="0">'+
          '<div class="C-hint">M/S stereo spread — 0=mono · 100=full wide</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔴 Dist on Side</span><span class="C-val" id="v-widerDist">0%</span></div>'+
          '<input type="range" id="sl-widerDist" min="0" max="500" value="0" step="1">'+
          '<div class="C-hint">raw distortion on side signal only — no limiter</div></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🌡 Sat on Side</span><span class="C-val" id="v-widerSat">0%</span></div>'+
          '<input type="range" id="sl-widerSat" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🔊 Bass on Wide</span><span class="C-val" id="v-widerBass">0%</span></div>'+
          '<input type="range" id="sl-widerBass" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">💨 Air on Wide</span><span class="C-val" id="v-widerAir">0%</span></div>'+
          '<input type="range" id="sl-widerAir" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">⚡ Side Boost</span><span class="C-val" id="v-widerGain">1.0×</span></div>'+
          '<input type="range" id="sl-widerGain" min="1" max="20" value="1" step="0.5">'+
          '<div class="C-hint">extra gain on wide side signal — louder than main gain</div></div>'+
        '<div class="S-ttl">Modulation</div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🎵 Chorus</span><span class="C-val" id="v-chorus">0%</span></div>'+
          '<input type="range" id="sl-chorus" min="0" max="100" value="0"></div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🌀 Flanger</span><span class="C-val" id="v-flanger">0%</span></div>'+
          '<input type="range" id="sl-flanger" min="0" max="100" value="0"></div>'+
      '</div>'+

      /* ═══ FX ═══ */
      '<div class="P" data-pane="fx">'+
        '<div class="C-hint" style="margin-bottom:6px">Toggle effects on/off</div>'+
        '<div class="FX-grid">'+fxCells+'</div>'+
      '</div>'+

      /* ═══ POWER ═══ */
      '<div class="P" data-pane="power">'+
        '<div class="PW-grid">'+
          '<div class="PW-btn" id="pw-fakemute">'+
            '<div class="PW-icon">🔇</div>'+
            '<div class="PW-lbl">Fake Mute</div>'+
            '<div class="PW-sub">Mic stays active</div>'+
          '</div>'+
          '<div class="PW-btn" id="pw-deafen">'+
            '<div class="PW-icon">🎧</div>'+
            '<div class="PW-lbl">Real Deafen</div>'+
            '<div class="PW-sub">Silences others</div>'+
          '</div>'+
          '<div class="PW-btn CHAOS-btn" id="pw-chaos">'+
            '<div class="PW-icon">💥</div>'+
            '<div class="PW-lbl">CHAOS MODE</div>'+
            '<div class="PW-sub">dist=500% presence=+15 exciter=100% sub=+12</div>'+
          '</div>'+
        '</div>'+
      '</div>'+

      /* ═══ PRESETS ═══ */
      '<div class="P" data-pane="presets">'+
        '<div class="PR-list">'+prRows+'</div>'+
      '</div>'+

      /* ═══ VOICE CHANGER ═══ */
      (function(){
        var groups={}, gcells='';
        VP.forEach(function(vp,idx){
          if(!groups[vp.g]) groups[vp.g]=[];
          groups[vp.g].push({vp:vp,idx:idx});
        });
        Object.keys(groups).forEach(function(g){
          gcells+='<div class="VP-grp-lbl">'+g+'</div><div class="VP-grid">';
          groups[g].forEach(function(item){
            gcells+='<div class="VP-btn" data-vp="'+item.idx+'"><div class="VP-icon">'+item.vp.i+'</div><div class="VP-nm">'+item.vp.n+'</div></div>';
          });
          gcells+='</div>';
        });
        return '<div class="P" data-pane="voice">'+
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
            '<span style="font-size:12px;color:#94a3b8;font-weight:600">50 REAL-TIME VOICE EFFECTS</span>'+
            '<button class="RST" id="vp-reset" style="padding:3px 8px;font-size:11px">Reset</button>'+
          '</div>'+
          gcells+
        '</div>';
      })()+

      /* ═══ STATS ═══ */
      '<div class="P" data-pane="stats">'+
        '<div class="ST-grid">'+
          '<div class="ST-card"><div class="ST-lbl">Input Level</div><div class="ST-val" id="st-level">-∞ dB</div></div>'+
          '<div class="ST-card"><div class="ST-lbl">Peak dB</div><div class="ST-val" id="st-peak">-∞ dB</div></div>'+
          '<div class="ST-card"><div class="ST-lbl">Clip Count</div><div class="ST-val" id="st-clips">0</div></div>'+
          '<div class="ST-card"><div class="ST-lbl">Session</div><div class="ST-val" id="st-sess">0m 00s</div></div>'+
        '</div>'+
        '<button class="RST" id="rh-rst-stats" style="margin-top:8px">↺ Reset Stats</button>'+
      '</div>'+

      /* ═══ MP3 ═══ */
      '<div class="P" data-pane="mp3">'+
        '<div class="MP-drop" id="mp-drop">'+
          '<input type="file" id="mp-file" accept="audio/*" style="display:none">'+
          '<div class="MP-drop-icon">🎵</div>'+
          '<div class="MP-drop-lbl">Tap or drop MP3 / WAV / OGG<br>plays through mic — same distortion chain</div>'+
        '</div>'+
        '<div class="MP-name" id="mp-name">No file loaded</div>'+
        '<div class="MP-wave" id="mp-wave"></div>'+
        '<div class="MP-prog" id="mp-prog"><div class="MP-progf" id="mp-progf"></div></div>'+
        '<div class="MP-time" id="mp-time">0:00 / 0:00</div>'+
        '<div class="MP-ctl">'+
          '<div class="MP-btn" id="mp-stop" title="Stop">⏹</div>'+
          '<div class="MP-btn pl-on" id="mp-play" title="Play / Pause">▶</div>'+
          '<div class="MP-btn lp-on" id="mp-loop" title="Loop">🔁</div>'+
        '</div>'+
        '<div class="C"><div class="C-row"><span class="C-lbl">🎚 MP3 Level</span><span class="C-val" id="v-mp3vol">100%</span></div>'+
          '<input type="range" id="sl-mp3vol" min="0" max="200" value="100">'+
          '<div class="C-hint">pre-worklet level — 200% = 2× before distortion hits</div></div>'+
      '</div>'+

      '</div>'; /* .B */

    document.body.appendChild(w);

    /* Rescue overlay */
    var res=document.createElement('div'); res.id='rh-rescue';
    res.innerHTML='<div class="RB">⚠ Audio paused<br><span style="font-size:11px;font-weight:400;opacity:.8">tap to resume</span></div>';
    res.onclick=function(){ if(window.DiscordContext) window.DiscordContext.resume(); };
    document.body.appendChild(res);

    setInterval(function(){
      var e=document.getElementById('rh-rescue');
      if(!e) return;
      e.style.display=(window.DiscordContext&&window.DiscordContext.state==='suspended')?'flex':'none';
    },1500);

    this.bind();
    setTimeout(loadDevices, 1200);
  },

  bind: function(){
    /* ── Helper: bind a 0-100 slider → S[key] as 0-1 ── */
    function bindPct(slId, key, valId, fmtFn){
      var sl=document.getElementById(slId);
      var ve=document.getElementById(valId);
      if(!sl) return;
      sl.addEventListener('input',function(){
        var v=+this.value;
        S[key]=v/100;
        if(ve) ve.textContent = fmtFn ? fmtFn(v) : v+'%';
        CHAIN.update();
      });
    }

    bindPct('sl-clean','clean','v-clean');
    bindPct('sl-bass','bass','v-bass');
    bindPct('sl-air','air','v-air');
    /* comp removed from UI — binding kept so old saves don't crash */
    /* bindPct('sl-comp','comp','v-comp'); */
    bindPct('sl-gate','gate','v-gate');
    bindPct('sl-sat','sat','v-sat');
    bindPct('sl-distDry','distDry','v-distDry');
    bindPct('sl-shout','shout','v-shout');
    bindPct('sl-crush','crush','v-crush');
    bindPct('sl-bitcrush','bitcrush','v-bitcrush');
    bindPct('sl-volt','volt','v-volt');
    bindPct('sl-rep','rep','v-rep');
    bindPct('sl-exciter','exciter','v-exciter');
    bindPct('sl-reverb','reverb','v-reverb');
    bindPct('sl-echo','echo','v-echo');
    bindPct('sl-etime','etime','v-etime');
    bindPct('sl-efb','efb','v-efb');
    bindPct('sl-wider','wider','v-wider');
    bindPct('sl-chorus','chorus','v-chorus');
    bindPct('sl-flanger','flanger','v-flanger');
    bindPct('sl-widerWidth','widerWidth','v-widerWidth');
    bindPct('sl-widerSat',  'widerSat',  'v-widerSat');
    bindPct('sl-widerBass', 'widerBass', 'v-widerBass');
    bindPct('sl-widerAir',  'widerAir',  'v-widerAir');
    /* Wider Side Boost 1-20× */
    var wgsl=document.getElementById('sl-widerGain');
    if(wgsl) wgsl.addEventListener('input',function(){
      S.widerGain=+this.value;
      var wgve=document.getElementById('v-widerGain');
      if(wgve) wgve.textContent=(+this.value).toFixed(1)+'×';
      CHAIN.update();
    });
    /* Wider Distortion 0-500% → worklet 0-5 */
    var wdsl=document.getElementById('sl-widerDist');
    if(wdsl) wdsl.addEventListener('input',function(){
      S.widerDist=+this.value/100;
      var wdve=document.getElementById('v-widerDist');
      if(wdve) wdve.textContent=this.value+'%';
      CHAIN.update();
    });

    /* ── GAIN (log scale 0-100 → 1× to 100M×) ── */
    var gsl=document.getElementById('sl-gain');
    var gve=document.getElementById('v-gain');
    if(gsl){
      gsl.addEventListener('input',function(){
        S.gain=+this.value;
        if(gve) gve.textContent=fmtGain(S.gain);
        CHAIN.update();
      });
    }

    /* ── G1-G5 BOOST SLIDERS: 10× / 20× / 40× / 80× / 160× ── */
    ['g1','g2','g3','g4','g5'].forEach(function(key){
      var sl=document.getElementById('sl-'+key);
      var ve=document.getElementById('v-'+key);
      if(!sl) return;
      sl.addEventListener('input',function(){
        S[key]=Math.max(1,+this.value);
        if(ve) ve.textContent=S[key].toFixed(1)+'×';
        CHAIN.update();
      });
    });

    /* ── DISTORTION 0-1000% → worklet 0-10 ── */
    var dsl=document.getElementById('sl-dist');
    var dve=document.getElementById('v-dist');
    if(dsl){
      dsl.addEventListener('input',function(){
        var v=+this.value;
        S.dist=v/100;
        if(dve) dve.textContent=v+'%';
        CHAIN.update();
      });
    }

    /* ── PRESENCE -6 to +15 dB ── */
    var prsl=document.getElementById('sl-presence');
    var prve=document.getElementById('v-presence');
    if(prsl){
      prsl.addEventListener('input',function(){
        S.presence=+this.value;
        if(prve) prve.textContent=(S.presence>0?'+':'')+S.presence+'dB';
        CHAIN.update();
      });
    }

    /* ── SUB BODY 0 to +12 dB ── */
    var sbsl=document.getElementById('sl-subBody');
    var sbve=document.getElementById('v-subBody');
    if(sbsl){
      sbsl.addEventListener('input',function(){
        S.subBody=+this.value;
        if(sbve) sbve.textContent='+'+S.subBody+'dB';
        CHAIN.update();
      });
    }

    /* ── PITCH center=50 → -12 to +12 semitones ── */
    var psl=document.getElementById('sl-pit');
    var pve=document.getElementById('v-pit');
    if(psl){
      psl.addEventListener('input',function(){
        var st=Math.round((+this.value-50)/50*12);
        S.pit=st;
        if(pve) pve.textContent=(st>0?'+':'')+st+'st';
        CHAIN.update();
      });
    }

    /* ── 10-BAND EQ ── */
    for(var b=0;b<10;b++){
      (function(band){
        var sl=document.getElementById('sl-eq'+band);
        var ve=document.getElementById('v-eq'+band);
        if(!sl) return;
        sl.addEventListener('input',function(){
          var v=+this.value;
          S.eq[band]=v;
          if(ve) ve.textContent=(v>0?'+':'')+v;
          CHAIN.update();
        });
      })(b);
    }

    /* ── EQ FLATTEN ── */
    var flat=document.getElementById('rh-eq-flat');
    if(flat) flat.addEventListener('click',function(){
      for(var b=0;b<10;b++){
        S.eq[b]=0;
        var sl=document.getElementById('sl-eq'+b); if(sl) sl.value=0;
        var ve=document.getElementById('v-eq'+b); if(ve) ve.textContent='0';
      }
      CHAIN.update();
    });

    /* ── FX TOGGLE CELLS ── */
    var fxMap={robot:'robot',tremolo:'tremolo',stutter:'stutter',
               bitcrush:'bitcrush',chorus:'chorus',flanger:'flanger'};
    document.querySelectorAll('#rh .FX-cell').forEach(function(cell){
      cell.addEventListener('click',function(){
        var id=this.dataset.fx;
        S[id]=S[id]>0?0:1;
        this.classList.toggle('on',S[id]>0);
        CHAIN.update();
      });
    });

    /* ── POWER BUTTONS ── */
    var pwFake=document.getElementById('pw-fakemute');
    if(pwFake) pwFake.addEventListener('click',function(){
      S.fakeMute=!S.fakeMute;
      window.RHFakeMute=S.fakeMute;
      this.classList.toggle('on',S.fakeMute);
    });

    var pwDeaf=document.getElementById('pw-deafen');
    if(pwDeaf) pwDeaf.addEventListener('click',function(){
      S.realDeafen=!S.realDeafen;
      window.RHApplyRealDeafen(S.realDeafen);
      this.classList.toggle('on',S.realDeafen);
    });

    var pwChaos=document.getElementById('pw-chaos');
    if(pwChaos) pwChaos.addEventListener('click',function(){
      S.chaos=S.chaos?0:1;
      this.classList.toggle('on',S.chaos>0);
      /* When chaos ON, slam all parameters to max */
      if(S.chaos){
        S.gain=100; S.dist=10; S.presence=15; S.exciter=1; S.subBody=12;
        S.g1=10; S.g2=20; S.g3=40; S.g4=80; S.g5=160;
        document.getElementById('sl-gain').value=100;
        document.getElementById('v-gain').textContent=fmtGain(100);
        document.getElementById('sl-dist').value=1000;
        ['g1','g2','g3','g4','g5'].forEach(function(k){var el=document.getElementById('sl-'+k);if(el)el.value=S[k];var v=document.getElementById('v-'+k);if(v)v.textContent=S[k].toFixed(1)+'×';});
        document.getElementById('v-dist').textContent='500%';
      }
      CHAIN.update();
    });

    /* ── VOICE CHANGER PRESETS ── */
    document.querySelectorAll('#rh .VP-btn').forEach(function(btn){
      btn.addEventListener('click',function(){
        var idx=+this.dataset.vp;
        if(!VP[idx]) return;
        document.querySelectorAll('#rh .VP-btn').forEach(function(b){b.classList.remove('on');});
        this.classList.add('on');
        applyVoicePreset(VP[idx]);
      });
    });
    var vpReset=document.getElementById('vp-reset');
    if(vpReset) vpReset.addEventListener('click',function(){
      document.querySelectorAll('#rh .VP-btn').forEach(function(b){b.classList.remove('on');});
      applyVoicePreset({s:{pit:0,robot:0,reverb:0,chorus:0,flanger:0,bitcrush:0,dist:0,tremolo:0,stutter:0,echo:0,bass:0,air:0,chaos:false}});
    });

    /* ── PRESETS ── */
    document.querySelectorAll('#rh .PR-row').forEach(function(row){
      row.addEventListener('click',function(){
        var i=+this.dataset.preset;
        applyPreset(PRESETS[i]);
        row.style.background='rgba(139,92,246,.2)';
        setTimeout(function(){ row.style.background=''; },500);
      });
    });

    /* ── STATS RESET ── */
    var srst=document.getElementById('rh-rst-stats');
    if(srst) srst.addEventListener('click',function(){
      S.clipCount=0; S.peakDb=-Infinity; S.sessionStart=Date.now();
    });

    /* ── RESET ALL ── */
    var rst=document.getElementById('rh-rst');
    if(rst) rst.addEventListener('click',function(){
      document.querySelectorAll('#rh input[type=range]').forEach(function(e){
        if(e.id==='sl-pit') e.value=50;
        else if(e.id==='sl-distDry') e.value=20;
        else e.value=0;
        e.dispatchEvent(new Event('input'));
      });
      for(var b=0;b<10;b++){
        S.eq[b]=0;
        var sl=document.getElementById('sl-eq'+b); if(sl) sl.value=0;
        var ve=document.getElementById('v-eq'+b); if(ve) ve.textContent='0';
      }
      S.pit=0; S.presence=0; S.subBody=0; S.chaos=0;
        S.g1=1; S.g2=1; S.g3=1; S.g4=1; S.g5=1;
      CHAIN.update();
    });

    /* ── TABS ── */
    var tabs=document.querySelectorAll('#rh .T-tab');
    var panes=document.querySelectorAll('#rh .P');
    tabs.forEach(function(t){
      t.addEventListener('click',function(){
        var n=this.dataset.tab;
        tabs.forEach(function(x){ x.classList.toggle('on',x.dataset.tab===n); });
        panes.forEach(function(x){ x.classList.toggle('on',x.dataset.pane===n); });
      });
    });

    /* ── MONITOR ── */
    var mon=document.getElementById('rh-mon');
    if(mon) mon.addEventListener('click',function(){
      CHAIN.setMon(!CHAIN.monOn);
      this.classList.toggle('on',CHAIN.monOn);
    });

    /* ── COLLAPSE ── */
    var col=document.getElementById('rh-col');
    var wr=document.getElementById('rh');
    if(col) col.addEventListener('click',function(){
      var c=wr.classList.toggle('rh-coll');
      this.textContent=c?'▸':'▾';
    });

    /* ── VC JOIN ── */
    var vcb=document.getElementById('rh-vc');
    if(vcb) vcb.addEventListener('click',function(){
      if(!joinVC()){
        vcb.textContent='No VC found';
        setTimeout(function(){ vcb.textContent='Join VC ▶'; },2000);
      }
    });

    /* ── DEVICE APPLY ── */
    var devApply=document.getElementById('rh-devapply');
    if(devApply) devApply.addEventListener('click',function(){
      var sel=document.getElementById('rh-devsel');
      var devId=sel?sel.value:'';
      var ac={echoCancellation:false,noiseSuppression:false,autoGainControl:false,sampleRate:48000,channelCount:2};
      if(devId) ac.deviceId={exact:devId};
      _gum({audio:ac}).then(function(s){
        var ctx=window.DiscordContext; if(!ctx) return;
        var src=ctx.createMediaStreamSource(s);
        var dest=CHAIN._dest;
        if(!dest) return;
        try{ if(CHAIN.node) CHAIN.node.disconnect(dest); }catch(e){}
        src.connect(CHAIN.node||dest);
        if(CHAIN.node) CHAIN.node.connect(dest);
        UI.setStatus('MIC OK','#22c55e');
      }).catch(function(e){ console.warn('[RHv6] device switch',e); });
    });

    /* ── MP3 PLAYER ── */
    (function(){
      var dropEl   = document.getElementById('mp-drop');
      var fileIn   = document.getElementById('mp-file');
      var nameEl   = document.getElementById('mp-name');
      var waveEl   = document.getElementById('mp-wave');
      var progEl   = document.getElementById('mp-prog');
      var progFill = document.getElementById('mp-progf');
      var timeEl   = document.getElementById('mp-time');
      var playBtn  = document.getElementById('mp-play');
      var stopBtn  = document.getElementById('mp-stop');
      var loopBtn  = document.getElementById('mp-loop');
      var volSl    = document.getElementById('sl-mp3vol');
      var volVal   = document.getElementById('v-mp3vol');
      if(!dropEl) return;

      /* Build waveform bars */
      for(var wb=0;wb<28;wb++){
        var b=document.createElement('div'); b.className='MP-wbar';
        waveEl.appendChild(b);
      }

      function fmtT(s){
        if(!isFinite(s)||s<0) s=0;
        return Math.floor(s/60)+':'+(''+(Math.floor(s)%60)).padStart(2,'0');
      }

      function mp3GetCtx(){
        if(window.DiscordContext) return window.DiscordContext;
        return new (window.AudioContext||window.webkitAudioContext)({sampleRate:48000});
      }

      function mp3EnsureGain(ctx){
        if(!MP3.gainNode || MP3.gainNode.context !== ctx){
          MP3.gainNode = ctx.createGain();
          MP3.gainNode.gain.value = MP3.volume;
          /* Connect to mp3Gain bus → worklet (with fallback to raw dest) */
          if(CHAIN.mp3Gain) MP3.gainNode.connect(CHAIN.mp3Gain);
          else if(CHAIN.node)  MP3.gainNode.connect(CHAIN.node);
          else MP3.gainNode.connect(ctx.destination); // fallback: audible even without worklet
        }
      }

      function mp3Load(file){
        if(!file) return;
        nameEl.textContent = file.name;
        MP3.fileName = file.name;
        var fr = new FileReader();
        fr.onload = function(e){
          var ctx = mp3GetCtx();
          ctx.decodeAudioData(e.target.result.slice(0)).then(function(buf){
            if(MP3.source){ try{ MP3.source.stop(); }catch(ex){} }
            MP3.buffer  = buf;
            MP3.playing = false;
            MP3.offset  = 0;
            playBtn.textContent = '▶';
            /* Draw waveform */
            var bars = waveEl.querySelectorAll('.MP-wbar');
            var ch = buf.getChannelData(0);
            var step = Math.max(1, Math.floor(ch.length / bars.length));
            bars.forEach(function(bEl, i){
              var rms=0;
              for(var k=0;k<step&&(i*step+k)<ch.length;k++) rms+=ch[i*step+k]*ch[i*step+k];
              rms = Math.sqrt(rms/step);
              bEl.style.height = Math.max(3, Math.round(rms*140))+'px';
              bEl.style.background = 'rgba('+(90+Math.round(rms*165))+',92,246,0.72)';
            });
            timeEl.textContent = '0:00 / '+fmtT(buf.duration);
            nameEl.style.color='#22c55e';
            setTimeout(function(){ nameEl.style.color=''; },900);
          }).catch(function(err){ nameEl.textContent='Error: '+err.message; });
        };
        fr.readAsArrayBuffer(file);
      }

      function mp3Play(){
        if(!MP3.buffer) return;
        var ctx = mp3GetCtx();
        if(ctx.state==='suspended') ctx.resume();
        if(MP3.source){ try{ MP3.source.stop(); }catch(ex){} }
        mp3EnsureGain(ctx);
        var src = ctx.createBufferSource();
        src.buffer    = MP3.buffer;
        src.loop      = MP3.loop;
        src.loopStart = 0;
        src.loopEnd   = MP3.buffer.duration;
        src.connect(MP3.gainNode);
        var off = MP3.offset % MP3.buffer.duration;
        src.start(0, off);
        MP3.source    = src;
        MP3.startTime = ctx.currentTime - off;
        MP3.playing   = true;
        playBtn.textContent = '⏸';
        playBtn.classList.add('pl-on');
        src.onended = function(){
          if(!MP3.loop){ MP3.playing=false; MP3.offset=0; playBtn.textContent='▶'; playBtn.classList.remove('pl-on'); }
        };
      }

      function mp3Pause(){
        if(!MP3.playing||!MP3.buffer) return;
        var ctx = window.DiscordContext;
        if(ctx) MP3.offset = (ctx.currentTime - MP3.startTime) % MP3.buffer.duration;
        try{ if(MP3.source) MP3.source.stop(); }catch(ex){}
        MP3.playing = false;
        playBtn.textContent = '▶';
        playBtn.classList.remove('pl-on');
      }

      function mp3Stop(){
        try{ if(MP3.source) MP3.source.stop(); }catch(ex){}
        MP3.playing=false; MP3.offset=0;
        playBtn.textContent='▶';
        playBtn.classList.remove('pl-on');
        if(progFill) progFill.style.width='0%';
        if(timeEl && MP3.buffer) timeEl.textContent='0:00 / '+fmtT(MP3.buffer.duration);
      }

      dropEl.addEventListener('click',function(){ fileIn.click(); });
      dropEl.addEventListener('dragover',function(e){ e.preventDefault(); dropEl.classList.add('dragover'); });
      dropEl.addEventListener('dragleave',function(){ dropEl.classList.remove('dragover'); });
      dropEl.addEventListener('drop',function(e){
        e.preventDefault(); dropEl.classList.remove('dragover');
        if(e.dataTransfer.files[0]) mp3Load(e.dataTransfer.files[0]);
      });
      fileIn.addEventListener('change',function(){ if(this.files[0]) mp3Load(this.files[0]); });
      playBtn.addEventListener('click',function(){ if(MP3.playing) mp3Pause(); else mp3Play(); });
      stopBtn.addEventListener('click',mp3Stop);
      loopBtn.addEventListener('click',function(){
        MP3.loop=!MP3.loop;
        loopBtn.classList.toggle('lp-on',MP3.loop);
      });

      /* Seek by clicking progress bar */
      progEl.addEventListener('click',function(e){
        if(!MP3.buffer) return;
        var r=progEl.getBoundingClientRect();
        MP3.offset = ((e.clientX-r.left)/r.width) * MP3.buffer.duration;
        if(MP3.offset<0) MP3.offset=0;
        if(MP3.playing){ mp3Pause(); mp3Play(); }
      });

      /* MP3 level slider */
      if(volSl){
        volSl.addEventListener('input',function(){
          var v=+this.value;
          MP3.volume = v/100;
          if(volVal) volVal.textContent=v+'%';
          if(MP3.gainNode) MP3.gainNode.gain.setTargetAtTime(MP3.volume, (window.DiscordContext||{currentTime:0}).currentTime||0, .04);
        });
      }

      /* Progress + time update at 4 Hz */
      setInterval(function(){
        if(!MP3.playing||!MP3.buffer||!window.DiscordContext) return;
        var pos = (window.DiscordContext.currentTime - MP3.startTime) % MP3.buffer.duration;
        if(pos<0) pos=0;
        if(progFill) progFill.style.width = ((pos/MP3.buffer.duration)*100)+'%';
        if(timeEl) timeEl.textContent = fmtT(pos)+' / '+fmtT(MP3.buffer.duration);
      }, 250);

      /* Re-route to mp3Gain bus once worklet loads (may not exist at bind time) */
      var _ra=0;
      (function reroute(){
        if(CHAIN.mp3Gain && MP3.gainNode && MP3.gainNode.context===window.DiscordContext){
          try{ MP3.gainNode.connect(CHAIN.mp3Gain); }catch(ex){}
          return;
        }
        if(++_ra<30) setTimeout(reroute,400);
      })();
    })();

    /* ── DRAG ── */
    var hd=document.getElementById('rh-hd'), wr2=document.getElementById('rh');
    if(hd&&wr2){
      var dx=0,dy=0,dragging=false;
      hd.addEventListener('mousedown',function(e){
        dragging=true;
        var r=wr2.getBoundingClientRect(); dx=e.clientX-r.left; dy=e.clientY-r.top;
        document.body.style.userSelect='none'; e.preventDefault();
      });
      document.addEventListener('mousemove',function(e){
        if(!dragging) return;
        var x=Math.max(0,Math.min(window.innerWidth-wr2.offsetWidth,e.clientX-dx));
        var y=Math.max(0,Math.min(window.innerHeight-40,e.clientY-dy));
        wr2.style.left=x+'px'; wr2.style.top=y+'px';
      });
      document.addEventListener('mouseup',function(){ dragging=false; document.body.style.userSelect=''; });
    }

    /* ── VU METER + STATS LOOP ── */
    var mf=document.getElementById('rh-mf');
    var vuBuf=new Uint8Array(512); var lastW=0;
    var statsTimer=0;

    (function tick(){
      if(CHAIN.an && mf){
        try{
          CHAIN.an.getByteTimeDomainData(vuBuf);
          var sum=0;
          for(var i=0;i<vuBuf.length;i++){
            var v=(vuBuf[i]-128)/128; sum+=v*v;
          }
          var rms=Math.sqrt(sum/vuBuf.length);
          var db = rms>0 ? 20*Math.log10(rms) : -Infinity;
          S.inputLevel=db;
          if(db>S.peakDb) S.peakDb=db;
          if(db>-1) S.clipCount++;
          var w=(Math.min(1,rms*8)*100)|0;
          if(Math.abs(w-lastW)>1){ mf.style.width=w+'%'; lastW=w; }
        }catch(e){}
      }

      /* Update stats panel at ~2Hz */
      statsTimer++;
      if(statsTimer%30===0){
        var lv=document.getElementById('st-level');
        var pk=document.getElementById('st-peak');
        var cl=document.getElementById('st-clips');
        var ss=document.getElementById('st-sess');
        if(lv) lv.textContent=fmtDb(S.inputLevel);
        if(pk) pk.textContent=fmtDb(S.peakDb);
        if(cl) cl.textContent=S.clipCount.toString();
        if(ss) ss.textContent=fmtTime(Date.now()-S.sessionStart);
      }

      requestAnimationFrame(tick);
    })();
  }
};

/* ── 11. BOOT ─────────────────────────────────────────────
   Wait for DOM, then init UI (rescue overlay + controls).
   AudioContext patch is already active at document_start.
─────────────────────────────────────────────────────────── */
function boot(){
  if(document.body&&document.head){ UI.init(); }
  else{ setTimeout(boot,40); }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
else boot();

}());
