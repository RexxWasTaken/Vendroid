/* ════════════════════════════════════════════════════════════════
   StereoLoudMic — Vendroid custom audio plugin
   Ported from the user's Rexx's Hook (RexxCord) engine, ADDITIVE on
   top of Vencord: Discord -> Vencord runtime -> Vencord plugins ->
   StereoLoudMic. Loaded independently from the custom plugin loader
   after Vencord has initialized (see Vendroid custom plugin loader).

   Changes vs the original Rexx hook:
     - getUserMedia no longer forces channelCount:1. Real stereo mic
       input is requested and, when available, carried through the
       whole DSP chain as true independent L/R (the engine already
       processes i0[1] separately when present — see process()).
     - masterGain/boost math rewritten so the AudioParam value is
       always finite and clamped, even though the UI can still show
       a huge display number.
     - Added a master StereoLoudMic ON/OFF (full bypass to normal
       Discord mic) and a separate Stereo ON/OFF toggle.
     - FAB button anchors itself next to Discord's own mic/mute
       button when in a call, instead of a fixed corner position.
════════════════════════════════════════════════════════════════ */
(function(){
'use strict';
if(window.__STEREOLOUDMIC__)return;
window.__STEREOLOUDMIC__=true;

/* ─── STATE ──────────────────────────────────────────────────── */
var ST={
  on:true, page:'main',
  /* StereoLoudMic master + stereo toggles (new) */
  stereoOn:true,
  /* Master */
  masterGain:20,  /* 0-20 */
  preAmp:1,     /* 0-1  */
  boost:1,     /* 0-1  */
  mix:1,          /* 0-1  */
  /* Gain Stages */
  gainStages:[0,0,0,0,0],
  gainStageOn:[true,true,true,true,true],
  /* Dynamics */
  gate:0, comp:0,
  /* Tone */
  presence:1, clarity:1, air:1, bass:1,
  /* Voice */
  pitch:0, voiceMode:0, voiceProfile:'normal',
  /* Mic Boost */
  micBoostOn:true, sensitivity:3,
  /* EQ */
  eq:[6,8,10,12,12,12,10,8,6,4], eqPreset:'flat',
  /* Distortion */
  distMode:2, distDrive:0.9, distTone:0.6, distMix:0.4, distOut:2,
  /* Wider */
  widerMode:0, widerWidth:0, widerDepth:0.5, widerStereo:0.5,
  /* Reverb */
  reverbWet:0, reverbDecay:2, reverbRoom:1, reverbPre:0, reverbDamp:0.5,
  /* Echo */
  echoWet:0, echoTime:0.3, echoFb:0.4,
  /* MP3 */
  mp3Vol:0.8, mp3MicMix:0.5,
  /* Monitor */
  monOn:false, monVol:0.6,
};
var SK='slm_st_v1', PK='slm_pr_v1', POSK='slm_pos_v1';
function saveState(){ try{ localStorage.setItem(SK,JSON.stringify(ST)); }catch(e){} }
function loadState(){ try{ var s=localStorage.getItem(SK); if(s) Object.assign(ST,JSON.parse(s)); }catch(e){} }
function getPresets(){ try{ return JSON.parse(localStorage.getItem(PK)||'[]'); }catch(e){ return []; } }
function setPresets(a){ try{ localStorage.setItem(PK,JSON.stringify(a)); }catch(e){} }

/* ─── VOICE PROFILES ──────────────────────────────────────────── */
var VOICE_PROFILES=[
  {id:'normal',       cat:'Natural',icon:'🎤',name:'Normal',          pitch:0,  vm:0, eq:[0,0,0,0,0,0,0,0,0,0],  pa:0.3,dm:0,dv:0,   mx:0,   rw:0,   rd:1.5,rr:1,ww:0,   ps:1,  mb:false},
  {id:'mic_boost',    cat:'Tools',  icon:'🔊',name:'Mic Boost',        pitch:0,  vm:0, eq:[0,0,0,0,0,0,0,0,0,0],  pa:0,  dm:0,dv:0,   mx:0,   rw:0,   rd:1.5,rr:1,ww:0,   ps:2,  mb:true},
  {id:'podcast',      cat:'Natural',icon:'🎙',name:'Podcast',          pitch:0,  vm:0, eq:[-1,0,0,2,3,3,2,1,0,-1],pa:0.3,dm:0,dv:0,   mx:0,   rw:0.08,rd:1.0,rr:1,ww:0.1, ps:1,  mb:false},
  {id:'broadcast',    cat:'Natural',icon:'📡',name:'Broadcast',        pitch:0,  vm:0, eq:[0,-1,0,1,3,4,3,2,0,-1],pa:0.3,dm:0,dv:0,   mx:0,   rw:0.05,rd:0.8,rr:1,ww:0,   ps:1,  mb:false},
  {id:'streaming',    cat:'Natural',icon:'🖥',name:'Streamer',         pitch:0,  vm:0, eq:[0,0,-1,1,3,4,3,2,1,-1],pa:0.3,dm:0,dv:0,   mx:0,   rw:0.06,rd:1.0,rr:1,ww:0.15,ps:1,  mb:false},
  {id:'narrator',     cat:'Natural',icon:'📖',name:'Narrator',         pitch:-1, vm:0, eq:[1,0,0,1,2,2,1,0,0,-1], pa:0.2,dm:0,dv:0,   mx:0,   rw:0.1, rd:1.2,rr:1,ww:0.1, ps:1,  mb:false},
  {id:'announcer',    cat:'Natural',icon:'📣',name:'Announcer',        pitch:-1, vm:0, eq:[2,1,0,1,3,3,2,1,0,-1], pa:0.3,dm:0,dv:0,   mx:0,   rw:0.06,rd:0.9,rr:1,ww:0,   ps:1,  mb:false},
  {id:'news_anchor',  cat:'Natural',icon:'🗞',name:'News Anchor',      pitch:0,  vm:0, eq:[0,0,0,2,3,3,2,1,0,-1], pa:0.25,dm:0,dv:0,  mx:0,   rw:0.04,rd:0.8,rr:1,ww:0,   ps:1,  mb:false},
  {id:'storyteller',  cat:'Natural',icon:'📜',name:'Storyteller',      pitch:-1, vm:0, eq:[2,1,1,0,1,2,2,1,0,-1], pa:0.2,dm:0,dv:0,   mx:0,   rw:0.15,rd:1.5,rr:1,ww:0.1, ps:1,  mb:false},
  {id:'male_deep',    cat:'Male',   icon:'👨',name:'Male Deep',        pitch:-3, vm:0, eq:[3,3,2,0,-1,-2,-1,-1,-1,-2],pa:0.2,dm:0,dv:0,mx:0,rw:0.08,rd:1.2,rr:1, ww:0.1, ps:1,  mb:false},
  {id:'male_heavy',   cat:'Male',   icon:'🧔',name:'Male Heavy',       pitch:-4, vm:0, eq:[4,4,3,1,-1,-2,-2,-2,-1,-2],pa:0.3,dm:0,dv:0,mx:0,rw:0.1, rd:1.5,rr:1, ww:0.1, ps:1,  mb:false},
  {id:'dark_voice',   cat:'Male',   icon:'🌑',name:'Dark Voice',       pitch:-4, vm:0, eq:[4,3,2,1,0,-2,-3,-3,-2,-2],pa:0.2,dm:0,dv:0,mx:0,rw:0.15,rd:2,  rr:1, ww:0.1, ps:1,  mb:false},
  {id:'deep_voice',   cat:'Male',   icon:'🔉',name:'Deep Voice',       pitch:-5, vm:5, eq:[5,4,3,1,-1,-3,-3,-3,-2,-3],pa:0.3,dm:0,dv:0,mx:0,rw:0.1, rd:1.8,rr:1, ww:0.15,ps:1,  mb:false},
  {id:'extra_deep',   cat:'Male',   icon:'⬇',name:'Extra Deep',       pitch:-8, vm:5, eq:[6,5,4,2,-1,-4,-4,-4,-3,-4],pa:0.4,dm:0,dv:0.3,mx:0.1,rw:0.15,rd:2.5,rr:1,ww:0.2, ps:1,  mb:false},
  {id:'gamer',        cat:'Male',   icon:'🎮',name:'Gamer',            pitch:-1, vm:0, eq:[2,1,0,1,3,3,2,1,1,-1],    pa:0.2,dm:0,dv:0,mx:0,rw:0.08,rd:1.0,rr:1, ww:0.2, ps:1,  mb:false},
  {id:'viking',       cat:'Male',   icon:'⚔',name:'Viking',           pitch:-4, vm:0, eq:[5,4,3,1,0,-1,-1,-1,-1,-2], pa:0.3,dm:1,dv:0.2,mx:0.1,rw:0.25,rd:3.0,rr:1.5,ww:0.2, ps:1,  mb:false},
  {id:'knight',       cat:'Male',   icon:'🛡',name:'Knight',           pitch:-3, vm:0, eq:[4,3,2,1,0,-1,-1,-1,-1,-2], pa:0.2,dm:1,dv:0.15,mx:0.08,rw:0.2,rd:2.5,rr:1.3,ww:0.15,ps:1, mb:false},
  {id:'female_soft',  cat:'Female', icon:'👩',name:'Female Soft',      pitch:4,  vm:0, eq:[-2,-1,0,1,2,3,3,2,1,-1],  pa:0.1,dm:0,dv:0,mx:0,rw:0.12,rd:1.5,rr:1, ww:0.15,ps:1,  mb:false},
  {id:'female_bright',cat:'Female', icon:'✨',name:'Female Bright',    pitch:5,  vm:0, eq:[-2,-2,0,1,3,4,4,3,2,-1],  pa:0.15,dm:0,dv:0,mx:0,rw:0.08,rd:1.2,rr:1,ww:0.1, ps:1,  mb:false},
  {id:'female_clear', cat:'Female', icon:'💎',name:'Female Clear',     pitch:3,  vm:0, eq:[-1,-1,0,1,2,4,4,3,2,-1],  pa:0.1,dm:0,dv:0,mx:0,rw:0.06,rd:1.0,rr:1, ww:0.1, ps:1,  mb:false},
  {id:'child',        cat:'Female', icon:'👧',name:'Child Voice',      pitch:7,  vm:0, eq:[-3,-2,-1,1,2,3,3,2,1,-1],  pa:0.1,dm:0,dv:0,mx:0,rw:0.06,rd:0.8,rr:1, ww:0.05,ps:1,  mb:false},
  {id:'anime_girl',   cat:'Anime',  icon:'🌸',name:'Anime Girl',       pitch:5,  vm:0, eq:[-2,-2,0,1,2,4,5,4,3,-1],  pa:0.2,dm:0,dv:0,mx:0,rw:0.1, rd:1.2,rr:1, ww:0.1, ps:1,  mb:false},
  {id:'anime_boy',    cat:'Anime',  icon:'⚡',name:'Anime Boy',        pitch:2,  vm:0, eq:[-1,-1,0,1,3,4,3,2,1,-1],  pa:0.2,dm:0,dv:0,mx:0,rw:0.08,rd:1.0,rr:1, ww:0.1, ps:1,  mb:false},
  {id:'anime_hero',   cat:'Anime',  icon:'🦸',name:'Anime Hero',       pitch:1,  vm:0, eq:[0,0,0,2,4,4,3,2,1,-1],    pa:0.25,dm:0,dv:0,mx:0,rw:0.1,rd:1.5,rr:1,  ww:0.2, ps:1,  mb:false},
  {id:'anime_villain',cat:'Anime',  icon:'🦹',name:'Anime Villain',    pitch:-3, vm:0, eq:[3,2,1,0,-1,-2,-1,-1,-1,-2],pa:0.2,dm:1,dv:0.2,mx:0.15,rw:0.2,rd:2,rr:1, ww:0.15,ps:1, mb:false},
  {id:'robot',        cat:'Robot',  icon:'🤖',name:'Robot',            pitch:0,  vm:1, eq:[0,0,0,0,0,0,0,0,0,0],     pa:0.2,dm:0,dv:0.3,mx:0.2,rw:0.05,rd:0.5,rr:1,ww:0.1, ps:1,  mb:false},
  {id:'android',      cat:'Robot',  icon:'📱',name:'Android',          pitch:-2, vm:1, eq:[0,0,0,0,1,1,0,0,0,-1],    pa:0.3,dm:2,dv:0.4,mx:0.3,rw:0.08,rd:0.8,rr:1,ww:0.15,ps:1,  mb:false},
  {id:'cyber',        cat:'Robot',  icon:'💻',name:'Cyber',            pitch:2,  vm:1, eq:[-1,0,0,0,1,2,1,0,-1,-2],  pa:0.3,dm:3,dv:0.5,mx:0.4,rw:0.1, rd:1.0,rr:1,ww:0.3, ps:1,  mb:false},
  {id:'ai_voice',     cat:'Robot',  icon:'🧠',name:'AI Voice',         pitch:0,  vm:0, eq:[-1,0,0,1,3,4,4,3,2,-1],   pa:0.2,dm:0,dv:0.1,mx:0.05,rw:0.06,rd:0.8,rr:1,ww:0.1,ps:1,  mb:false},
  {id:'digital',      cat:'Robot',  icon:'🔲',name:'Digital',          pitch:1,  vm:1, eq:[0,0,-1,0,1,2,2,1,0,-2],   pa:0.3,dm:4,dv:0.5,mx:0.35,rw:0.08,rd:0.7,rr:1,ww:0.2,ps:1,  mb:false},
  {id:'radio',        cat:'Radio',  icon:'📻',name:'Radio',            pitch:-1, vm:4, eq:[-3,-1,-1,1,4,4,3,1,-2,-3], pa:0.3,dm:4,dv:0.4,mx:0.3,rw:0.04,rd:0.5,rr:1,ww:0,   ps:1,  mb:false},
  {id:'old_radio',    cat:'Radio',  icon:'📡',name:'Old Radio',        pitch:-1, vm:4, eq:[-5,-2,-2,2,6,5,3,0,-3,-5], pa:0.4,dm:4,dv:0.6,mx:0.5,rw:0.06,rd:0.6,rr:1,ww:0,   ps:1,  mb:false},
  {id:'am_radio',     cat:'Radio',  icon:'📳',name:'AM Radio',         pitch:-1, vm:4, eq:[-6,-3,-3,1,7,6,4,-1,-5,-7],pa:0.5,dm:4,dv:0.7,mx:0.6,rw:0.06,rd:0.6,rr:1,ww:0,   ps:1,  mb:false},
  {id:'megaphone',    cat:'Radio',  icon:'📢',name:'Megaphone',        pitch:0,  vm:4, eq:[-4,-2,-1,2,5,4,2,0,-3,-5], pa:0.5,dm:4,dv:0.5,mx:0.5,rw:0.05,rd:0.4,rr:1,ww:0,   ps:1,  mb:false},
  {id:'telephone',    cat:'Radio',  icon:'☎',name:'Telephone',        pitch:0,  vm:4, eq:[-6,-3,-3,1,6,5,3,-1,-5,-8],pa:0.4,dm:4,dv:0.5,mx:0.4,rw:0,   rd:0.5,rr:1,ww:0,   ps:1,  mb:false},
  {id:'walkie',       cat:'Radio',  icon:'📟',name:'Walkie Talkie',    pitch:0,  vm:4, eq:[-5,-2,-2,2,6,5,3,-1,-4,-6],pa:0.5,dm:4,dv:0.7,mx:0.6,rw:0.04,rd:0.4,rr:1,ww:0,   ps:1,  mb:false},
  {id:'intercom',     cat:'Radio',  icon:'🔔',name:'Intercom',         pitch:0,  vm:4, eq:[-4,-2,-1,3,5,4,2,-1,-3,-5],pa:0.4,dm:4,dv:0.5,mx:0.4,rw:0.08,rd:0.6,rr:1,ww:0,   ps:1,  mb:false},
  {id:'demon',        cat:'Dark',   icon:'😈',name:'Demon',            pitch:-5, vm:2, eq:[5,4,3,1,-1,-3,-3,-3,-2,-3], pa:0.4,dm:1,dv:0.5,mx:0.3,rw:0.2, rd:2.5,rr:1.5,ww:0.2, ps:1, mb:false},
  {id:'monster',      cat:'Dark',   icon:'👾',name:'Monster',          pitch:-7, vm:2, eq:[6,5,4,2,-1,-4,-4,-4,-3,-4], pa:0.5,dm:2,dv:0.6,mx:0.4,rw:0.25,rd:3.0,rr:2,  ww:0.3, ps:1, mb:false},
  {id:'villain',      cat:'Dark',   icon:'💀',name:'Villain',          pitch:-4, vm:0, eq:[4,3,2,1,0,-2,-2,-2,-1,-2],  pa:0.3,dm:1,dv:0.3,mx:0.2,rw:0.2, rd:2.5,rr:1.5,ww:0.15,ps:1, mb:false},
  {id:'vampire',      cat:'Dark',   icon:'🧛',name:'Vampire',          pitch:-3, vm:0, eq:[3,2,1,0,-1,-2,-2,-2,-1,-2],  pa:0.2,dm:1,dv:0.2,mx:0.1,rw:0.3, rd:3.5,rr:2,  ww:0.15,ps:1, mb:false},
  {id:'zombie',       cat:'Dark',   icon:'🧟',name:'Zombie',           pitch:-2, vm:0, eq:[3,2,1,0,-1,-2,-3,-3,-2,-3],  pa:0.3,dm:2,dv:0.5,mx:0.4,rw:0.2, rd:2.0,rr:1.5,ww:0.1, ps:1, mb:false},
  {id:'ghost',        cat:'Dark',   icon:'👻',name:'Ghost',            pitch:-3, vm:0, eq:[0,0,0,-2,-3,-3,-2,-1,0,-1],  pa:0.1,dm:0,dv:0,  mx:0,  rw:0.5, rd:4.0,rr:2.5,ww:0.3, ps:1, mb:false},
  {id:'ghost_lord',   cat:'Dark',   icon:'🕯',name:'Ghost Lord',       pitch:-6, vm:2, eq:[4,3,2,-1,-3,-4,-4,-3,-2,-3], pa:0.3,dm:1,dv:0.4,mx:0.3,rw:0.55,rd:5.0,rr:3,  ww:0.3, ps:1, mb:false},
  {id:'thunder',      cat:'Dark',   icon:'⛈',name:'Thunder',          pitch:-8, vm:5, eq:[7,6,5,2,-1,-5,-5,-5,-4,-5],  pa:0.5,dm:2,dv:0.7,mx:0.5,rw:0.3, rd:4.0,rr:2,  ww:0.4, ps:1, mb:false},
  {id:'shadow',       cat:'Dark',   icon:'🌑',name:'Shadow',           pitch:-4, vm:0, eq:[4,3,2,0,-2,-4,-4,-3,-2,-3],  pa:0.2,dm:1,dv:0.3,mx:0.15,rw:0.35,rd:3.0,rr:1.8,ww:0.2,ps:1, mb:false},
  {id:'chipmunk',     cat:'Fun',    icon:'🐿',name:'Chipmunk',         pitch:7,  vm:3, eq:[-3,-2,-1,1,2,3,4,3,2,-1],   pa:0.1,dm:0,dv:0,mx:0,rw:0.04,rd:0.5,rr:1, ww:0.05,ps:1,  mb:false},
  {id:'baby',         cat:'Fun',    icon:'👶',name:'Baby',             pitch:10, vm:3, eq:[-4,-3,-2,1,3,4,4,3,2,-1],   pa:0.1,dm:0,dv:0,mx:0,rw:0.04,rd:0.5,rr:1, ww:0,   ps:1,  mb:false},
  {id:'alien',        cat:'Fun',    icon:'👽',name:'Alien',            pitch:3,  vm:1, eq:[-2,-1,0,0,2,3,3,2,1,-2],    pa:0.3,dm:3,dv:0.4,mx:0.3,rw:0.2, rd:2.5,rr:1.5,ww:0.3, ps:1,  mb:false},
  {id:'extraterr',    cat:'Fun',    icon:'🛸',name:'Extraterrestrial', pitch:5,  vm:1, eq:[-3,-2,-1,0,1,3,4,3,2,-2],   pa:0.3,dm:3,dv:0.5,mx:0.4,rw:0.3, rd:3.0,rr:2,  ww:0.4, ps:1,  mb:false},
  {id:'underwater',   cat:'Fun',    icon:'🌊',name:'Underwater',       pitch:-2, vm:0, eq:[3,2,1,-2,-5,-6,-6,-5,-4,-5], pa:0.2,dm:0,dv:0,mx:0,rw:0.4, rd:3.5,rr:2,  ww:0.2, ps:1,  mb:false},
  {id:'glitch',       cat:'Fun',    icon:'⚡',name:'Glitch',           pitch:0,  vm:1, eq:[0,0,-1,0,2,3,2,1,0,-2],     pa:0.4,dm:5,dv:0.8,mx:0.7,rw:0.15,rd:1.5,rr:1, ww:0.4, ps:1,  mb:false},
  {id:'cave',         cat:'Space',  icon:'🦇',name:'Cave',             pitch:-2, vm:0, eq:[3,2,1,-1,-2,-3,-3,-2,-1,-1], pa:0.2,dm:0,dv:0,mx:0,rw:0.55,rd:5.0,rr:2,  ww:0.2, ps:1,  mb:false},
  {id:'dungeon',      cat:'Space',  icon:'🏰',name:'Dungeon',          pitch:-3, vm:0, eq:[4,3,2,0,-2,-4,-4,-3,-2,-2],  pa:0.2,dm:0,dv:0,mx:0,rw:0.6, rd:6.0,rr:2.5,ww:0.25,ps:1,  mb:false},
  {id:'cathedral',    cat:'Space',  icon:'⛪',name:'Cathedral',        pitch:-1, vm:0, eq:[0,0,0,0,1,2,2,1,0,-1],       pa:0.1,dm:0,dv:0,mx:0,rw:0.65,rd:7.0,rr:3,  ww:0.3, ps:1,  mb:false},
  {id:'space',        cat:'Space',  icon:'🌌',name:'Space',            pitch:0,  vm:0, eq:[-1,-1,0,0,1,2,3,2,1,-1],     pa:0.1,dm:0,dv:0,mx:0,rw:0.7, rd:8.0,rr:3.5,ww:0.5, ps:1,  mb:false},
  {id:'epic',         cat:'Epic',   icon:'🎬',name:'Epic Voice',       pitch:-5, vm:5, eq:[5,4,3,1,1,2,2,1,0,-2],       pa:0.4,dm:1,dv:0.3,mx:0.2,rw:0.45,rd:4.5,rr:2,  ww:0.35,ps:1, mb:false},
  {id:'movie_trailer',cat:'Epic',   icon:'🎥',name:'Movie Trailer',    pitch:-6, vm:5, eq:[6,5,4,2,1,2,2,1,0,-2],       pa:0.5,dm:1,dv:0.3,mx:0.2,rw:0.5, rd:5.0,rr:2.5,ww:0.4, ps:1, mb:false},
  {id:'god',          cat:'Epic',   icon:'⚡',name:'God Voice',        pitch:-8, vm:5, eq:[7,6,5,3,1,2,2,1,0,-2],       pa:0.6,dm:1,dv:0.4,mx:0.25,rw:0.55,rd:6.0,rr:3, ww:0.5, ps:1, mb:false},
];

function applyVoiceProfile(pid){
  var p=VOICE_PROFILES.find(function(v){return v.id===pid;});
  if(!p)return;
  ST.voiceProfile=pid;
  ST.pitch=p.pitch; ST.voiceMode=p.vm; ST.eq=p.eq.slice();
  ST.preAmp=p.pa; ST.distMode=p.dm; ST.distDrive=p.dv; ST.distMix=p.mx;
  ST.reverbWet=p.rw; ST.reverbDecay=p.rd; ST.reverbRoom=p.rr||1;
  ST.widerWidth=p.ww; ST.micBoostOn=!!p.mb;
  if(p.mb) ST.sensitivity=p.ps||1.0;
  CHAIN.update(); saveState();
}

/* ─── WORKLET ─────────────────────────────────────────────────── */
var WK=`
class BQ{
  constructor(){this.x1=0;this.x2=0;this.y1=0;this.y2=0;this.b0=1;this.b1=0;this.b2=0;this.a1=0;this.a2=0;}
  proc(x){
    if(!isFinite(x))x=0;
    var y=this.b0*x+this.b1*this.x1+this.b2*this.x2-this.a1*this.y1-this.a2*this.y2;
    this.x2=this.x1;this.x1=x;this.y2=this.y1;this.y1=isFinite(y)?y:0;return this.y1;
  }
  peak(f,g,Q){
    var A=Math.pow(10,g/40),w=2*Math.PI*f/sampleRate,s=Math.sin(w),c=Math.cos(w),al=s/(2*Q),a0=1+al/A;
    this.b0=(1+al*A)/a0;this.b1=-2*c/a0;this.b2=(1-al*A)/a0;this.a1=-2*c/a0;this.a2=(1-al/A)/a0;
  }
  loShelf(f,g){
    var A=Math.pow(10,g/40),w=2*Math.PI*f/sampleRate,s=Math.sin(w),c=Math.cos(w),al=s/Math.SQRT2,sq=2*Math.sqrt(A)*al;
    var a0=(A+1)+(A-1)*c+sq;
    this.b0=A*((A+1)-(A-1)*c+sq)/a0;this.b1=2*A*((A-1)-(A+1)*c)/a0;this.b2=A*((A+1)-(A-1)*c-sq)/a0;
    this.a1=-2*((A-1)+(A+1)*c)/a0;this.a2=((A+1)+(A-1)*c-sq)/a0;
  }
  hiShelf(f,g){
    var A=Math.pow(10,g/40),w=2*Math.PI*f/sampleRate,s=Math.sin(w),c=Math.cos(w),al=s/Math.SQRT2,sq=2*Math.sqrt(A)*al;
    var a0=(A+1)-(A-1)*c+sq;
    this.b0=A*((A+1)+(A-1)*c+sq)/a0;this.b1=-2*A*((A-1)+(A+1)*c)/a0;this.b2=A*((A+1)+(A-1)*c-sq)/a0;
    this.a1=2*((A-1)-(A+1)*c)/a0;this.a2=((A+1)-(A-1)*c-sq)/a0;
  }
  hiPass(f,Q){
    var w=2*Math.PI*f/sampleRate,s=Math.sin(w),c=Math.cos(w),al=s/(2*(Q||0.707));
    var a0=1+al;
    this.b0=(1+c)*0.5/a0;this.b1=-(1+c)/a0;this.b2=(1+c)*0.5/a0;
    this.a1=-2*c/a0;this.a2=(1-al)/a0;
  }
  loPass(f,Q){
    var w=2*Math.PI*f/sampleRate,s=Math.sin(w),c=Math.cos(w),al=s/(2*(Q||0.707));
    var a0=1+al;
    this.b0=(1-c)*0.5/a0;this.b1=(1-c)/a0;this.b2=(1-c)*0.5/a0;
    this.a1=-2*c/a0;this.a2=(1-al)/a0;
  }
  bypass(){this.b0=1;this.b1=0;this.b2=0;this.a1=0;this.a2=0;}
}

class LP1{
  constructor(tc){this.y=0;this.a=1-Math.exp(-1/(tc*sampleRate));}
  proc(x){this.y+=this.a*(x-this.y);return this.y;}
}

class RexxEngine extends AudioWorkletProcessor{
  static get parameterDescriptors(){return[
    {name:'on',          defaultValue:1,   minValue:0,   maxValue:1},
    {name:'sensitivity', defaultValue:1,   minValue:0,   maxValue:3},
    {name:'micBoost',    defaultValue:0,   minValue:0,   maxValue:1},
    {name:'preAmp',      defaultValue:1,   minValue:1,   maxValue:21},
    {name:'masterGain',  defaultValue:1,   minValue:1,   maxValue:9999},
    {name:'boost',       defaultValue:1,   minValue:1,   maxValue:26},
    {name:'mix',         defaultValue:1,   minValue:0,   maxValue:1},
    {name:'gate',        defaultValue:0,   minValue:0,   maxValue:1},
    {name:'comp',        defaultValue:0,   minValue:0,   maxValue:1},
    {name:'presence',    defaultValue:0,   minValue:0,   maxValue:1},
    {name:'clarity',     defaultValue:0,   minValue:0,   maxValue:1},
    {name:'air',         defaultValue:0,   minValue:0,   maxValue:1},
    {name:'bass',        defaultValue:0,   minValue:0,   maxValue:1},
    {name:'pitch',       defaultValue:0,   minValue:-12, maxValue:12},
    {name:'voiceMode',   defaultValue:0,   minValue:0,   maxValue:5},
    {name:'distMode',    defaultValue:0,   minValue:0,   maxValue:5},
    {name:'distDrive',   defaultValue:0.5, minValue:0,   maxValue:1},
    {name:'distTone',    defaultValue:0.5, minValue:0,   maxValue:1},
    {name:'distMix',     defaultValue:0,   minValue:0,   maxValue:1},
    {name:'distOut',     defaultValue:1,   minValue:0,   maxValue:2},
    {name:'widerMode',   defaultValue:0,   minValue:0,   maxValue:3},
    {name:'widerWidth',  defaultValue:0,   minValue:0,   maxValue:2},
    {name:'widerDepth',  defaultValue:0.5, minValue:0,   maxValue:1},
    {name:'widerStereo', defaultValue:0.5, minValue:0,   maxValue:1},
    {name:'reverbWet',   defaultValue:0,   minValue:0,   maxValue:1},
    {name:'reverbDecay', defaultValue:2,   minValue:0.1, maxValue:10},
    {name:'reverbRoom',  defaultValue:1,   minValue:0.1, maxValue:4},
    {name:'reverbPre',   defaultValue:0,   minValue:0,   maxValue:0.1},
    {name:'reverbDamp',  defaultValue:0.5, minValue:0,   maxValue:1},
    {name:'echoWet',     defaultValue:0,   minValue:0,   maxValue:1},
    {name:'echoTime',    defaultValue:0.3, minValue:0.01,maxValue:1},
    {name:'echoFb',      defaultValue:0.4, minValue:0,   maxValue:0.9},
    {name:'eq0',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq1',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq2',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq3',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq4',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq5',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq6',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq7',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq8',defaultValue:0,minValue:-12,maxValue:12},
    {name:'eq9',defaultValue:0,minValue:-12,maxValue:12},
    {name:'gs1',defaultValue:0,minValue:-12,maxValue:24},
    {name:'gs2',defaultValue:0,minValue:-12,maxValue:24},
    {name:'gs3',defaultValue:0,minValue:-12,maxValue:24},
    {name:'gs4',defaultValue:0,minValue:-12,maxValue:24},
    {name:'gs5',defaultValue:0,minValue:-12,maxValue:24},
    {name:'gs1En',defaultValue:1,minValue:0,maxValue:1},
    {name:'gs2En',defaultValue:1,minValue:0,maxValue:1},
    {name:'gs3En',defaultValue:1,minValue:0,maxValue:1},
    {name:'gs4En',defaultValue:1,minValue:0,maxValue:1},
    {name:'gs5En',defaultValue:1,minValue:0,maxValue:1},
  ];}

  constructor(){
    super();
    this.eqL=[];this.eqR=[];
    for(var i=0;i<10;i++){this.eqL.push(new BQ());this.eqR.push(new BQ());}
    this.EQ_CFG=[
      {t:'lo',  f:80},
      {t:'peak',f:150,  Q:1.4},
      {t:'peak',f:400,  Q:1.4},
      {t:'peak',f:1000, Q:1.4},
      {t:'peak',f:2400, Q:1.4},
      {t:'peak',f:6000, Q:1.4},
      {t:'peak',f:12000,Q:1.4},
      {t:'peak',f:16000,Q:1.4},
      {t:'lo',  f:100},
      {t:'hi',  f:10000},
    ];
    this.lastEQ=new Array(10).fill(999);
    this.presL=new BQ();this.presR=new BQ();
    this.clarL=new BQ();this.clarR=new BQ();
    this.airFL=new BQ();this.airFR=new BQ();
    this.bassL=new BQ();this.bassR=new BQ();
    this.lastPR=-1;this.lastCL=-1;this.lastAI=-1;this.lastBS=-1;
    this.radHpL=new BQ();this.radHpR=new BQ();
    this.radHpL.hiPass(300,0.8);this.radHpR.hiPass(300,0.8);
    this.radLpL=new BQ();this.radLpR=new BQ();
    this.radLpL.loPass(3200,0.8);this.radLpR.loPass(3200,0.8);
    this.radHp2L=new BQ();this.radHp2R=new BQ();
    this.radHp2L.hiPass(300,0.5);this.radHp2R.hiPass(300,0.5);
    this.haasLen=Math.round(sampleRate*0.025)+1;
    this.haasR=new Float32Array(this.haasLen+2);
    this.haasPos=0;
    this.cmbLen=Math.round(sampleRate*0.0067)+1;
    this.cmbBuf=new Float32Array(this.cmbLen+2);
    this.cmbPos=0;
    var pb=Math.min(32768,Math.max(8192,(sampleRate*0.35)|0));
    this.pb=pb;
    this.pBL=new Float32Array(pb);this.pBR=new Float32Array(pb);
    this.pw=0;this.pr1=0;this.pr2=(pb*0.5)|0;this.ph1=0;this.ph2=0.5;
    this.rph=0;
    this.gateEnv=new LP1(0.008);
    this.compEnv=new LP1(0.05);
    this.limEnv=1.0;
    this.combLen=[2557,2617,2491,2422];
    this.cL=[];this.cR=[];this.cPos=[];
    for(var k=0;k<4;k++){
      this.cL.push(new Float32Array(this.combLen[k]));
      this.cR.push(new Float32Array(this.combLen[k]));
      this.cPos.push(0);
    }
    this.cdL=[];this.cdR=[];
    for(var k=0;k<4;k++){this.cdL.push(new LP1(0.003));this.cdR.push(new LP1(0.003));}
    this.apL=[new Float32Array(347),new Float32Array(113)];
    this.apR=[new Float32Array(347),new Float32Array(113)];
    this.apPos=[0,0];this.apLen=[347,113];
    this.preLen=Math.round(sampleRate*0.12)+1;
    this.preL=new Float32Array(this.preLen);this.preR=new Float32Array(this.preLen);
    this.prePos=0;
    this.ecLen=Math.round(sampleRate*1.1)+1;
    this.ecL=new Float32Array(this.ecLen);this.ecR=new Float32Array(this.ecLen);this.ecPos=0;
    this.dcL=0;this.dcR=0;
  }

  clamp(v,a,b){var n=+v;return isFinite(n)?Math.max(a,Math.min(b,n)):a;}
  softClip(x,drive){
    var d=this.clamp(drive,0.01,1)*3+1;
    var y=Math.tanh(x*d)/Math.tanh(d);
    return isFinite(y)?y:0;
  }
  limitSample(x){
    var abs=Math.abs(x);
    if(abs*this.limEnv>0.995) this.limEnv=0.995/Math.max(abs,1e-6);
    else this.limEnv=Math.min(1,this.limEnv*1.00015);
    return x*this.limEnv;
  }
  distort(x,mode,drive,tone){
    var d=1+drive*14;
    var pre=this.softClip(x*0.65,0.25);
    var y;
    switch(mode|0){
      case 0:y=Math.tanh(pre*d);break;
      case 1:y=pre>0?Math.tanh(pre*d):Math.tanh(pre*d*0.55)*1.15;break;
      case 2:{var t=Math.tanh(pre*d);y=t+Math.abs(t)*t*(drive*0.5);break;}
      case 3:{var sg=pre>0?1:-1;y=sg*(1-Math.exp(-Math.abs(pre)*d));break;}
      case 4:{var bp=Math.max(-1,Math.min(1,pre*d));y=Math.sign(bp)*Math.pow(Math.abs(bp)+1e-9,0.55*(1-tone*0.45));break;}
      default:{var th=0.75/(1+drive*2.5);y=Math.max(-th,Math.min(th,pre))/th;}
    }
    return this.softClip(y,0.08);
  }
  updateEQ(gains){
    for(var i=0;i<10;i++){
      if(Math.abs(gains[i]-this.lastEQ[i])<0.03)continue;
      this.lastEQ[i]=gains[i];
      var c=this.EQ_CFG[i];
      if(Math.abs(gains[i])<0.03){this.eqL[i].bypass();this.eqR[i].bypass();continue;}
      if(c.t==='lo'){this.eqL[i].loShelf(c.f,gains[i]);this.eqR[i].loShelf(c.f,gains[i]);}
      else if(c.t==='hi'){this.eqL[i].hiShelf(c.f,gains[i]);this.eqR[i].hiShelf(c.f,gains[i]);}
      else{this.eqL[i].peak(c.f,gains[i],c.Q);this.eqR[i].peak(c.f,gains[i],c.Q);}
    }
  }
  doReverb(L,R,wet,decay,room,pre,damp){
    if(pre>0.0005){
      var dt=Math.min(this.preLen-1,Math.round(pre*sampleRate));
      var pi=(this.prePos+this.preLen-dt)%this.preLen;
      var pL=this.preL[pi],pR=this.preR[pi];
      this.preL[this.prePos]=L;this.preR[this.prePos]=R;
      this.prePos=(this.prePos+1)%this.preLen;
      L=pL;R=pR;
    }
    var rt60=Math.max(0.1,decay*Math.max(0.1,room));
    var mL=0,mR=0;
    for(var k=0;k<4;k++){
      var fb=Math.min(0.989,Math.pow(10,-3*this.combLen[k]/(rt60*sampleRate)));
      var pos=this.cPos[k];
      var rawL=this.cL[k][pos],rawR=this.cR[k][pos];
      var dampCoef=Math.max(0.05,1-damp*0.92);
      var dampedL=this.cdL[k].proc(rawL)*dampCoef;
      var dampedR=this.cdR[k].proc(rawR)*dampCoef;
      this.cL[k][pos]=L+dampedL*fb;
      this.cR[k][pos]=R+dampedR*fb;
      this.cPos[k]=(pos+1)%this.combLen[k];
      mL+=rawL;mR+=rawR;
    }
    mL*=0.25;mR*=0.25;
    for(var k=0;k<2;k++){
      var pos2=this.apPos[k],len=this.apLen[k];
      var bL=this.apL[k][pos2],bR=this.apR[k][pos2];
      this.apL[k][pos2]=mL+bL*0.5;this.apR[k][pos2]=mR+bR*0.5;
      this.apPos[k]=(pos2+1)%len;
      mL=bL-mL*0.5;mR=bR-mR*0.5;
    }
    var rL=isFinite(mL)?mL:0;var rR=isFinite(mR)?mR:0;
    return{L:L*(1-wet)+rL*wet,R:R*(1-wet)+rR*wet};
  }

  process(inp,out,p){
    var i0=inp[0],o0=out[0];
    if(!i0||!i0[0])return true;
    if(p.on[0]<0.5){
      for(var i=0;i<i0[0].length;i++){
        o0[0][i]=i0[0][i]||0;
        if(o0[1])o0[1][i]=(i0[1]?i0[1][i]:i0[0][i])||0;
      }
      return true;
    }
    var SENS=p.sensitivity[0];
    var MB=p.micBoost[0]>0.5;
    var PA=p.preAmp[0];
    var MG=p.masterGain[0];
    var BT=p.boost[0];
    var MIX=p.mix[0];
    var GA=p.gate[0];
    var CO=p.comp[0];
    var PR=p.presence[0];
    var CL=p.clarity[0];
    var AI=p.air[0];
    var BS=p.bass[0];
    var PI=p.pitch[0];
    var VM=p.voiceMode[0]|0;
    var DM=p.distMode[0]|0;
    var DD=p.distDrive[0];
    var DT=p.distTone[0];
    var DX=p.distMix[0];
    var DO=p.distOut[0];
    var WM=p.widerMode[0]|0;
    var WW=p.widerWidth[0];
    var WD=p.widerDepth[0];
    var WS=p.widerStereo[0];
    var RW=p.reverbWet[0];
    var RD=p.reverbDecay[0];
    var RR=p.reverbRoom[0];
    var RP=p.reverbPre[0];
    var RDMP=p.reverbDamp[0];
    var EW=p.echoWet[0];
    var ET=p.echoTime[0];
    var EF=p.echoFb[0];
    var eqG=[p.eq0[0],p.eq1[0],p.eq2[0],p.eq3[0],p.eq4[0],p.eq5[0],p.eq6[0],p.eq7[0],p.eq8[0],p.eq9[0]];
    var GS1=p.gs1[0],GS2=p.gs2[0],GS3=p.gs3[0],GS4=p.gs4[0],GS5=p.gs5[0];
    var G1E=p.gs1En[0]>0.5,G2E=p.gs2En[0]>0.5,G3E=p.gs3En[0]>0.5,G4E=p.gs4En[0]>0.5,G5E=p.gs5En[0]>0.5;
    this.updateEQ(eqG);
    if(Math.abs(PR-this.lastPR)>0.005){this.lastPR=PR;if(PR>0.01){this.presL.peak(3500,PR*10,0.7);this.presR.peak(3500,PR*10,0.7);}else{this.presL.bypass();this.presR.bypass();}}
    if(Math.abs(CL-this.lastCL)>0.005){this.lastCL=CL;if(CL>0.01){this.clarL.peak(320,-CL*5,0.8);this.clarR.peak(320,-CL*5,0.8);}else{this.clarL.bypass();this.clarR.bypass();}}
    if(Math.abs(AI-this.lastAI)>0.005){this.lastAI=AI;if(AI>0.01){this.airFL.peak(9000,AI*11,0.7);this.airFR.peak(9000,AI*11,0.7);}else{this.airFL.bypass();this.airFR.bypass();}}
    if(Math.abs(BS-this.lastBS)>0.005){this.lastBS=BS;if(BS>0.01){this.bassL.loShelf(120,BS*10);this.bassR.loShelf(120,BS*10);}else{this.bassL.bypass();this.bassR.bypass();}}
    var len=i0[0].length;
    for(var i=0;i<len;i++){
      var L=i0[0][i]||0;
      var R=(i0[1]?i0[1][i]:L)||0;
      if(!isFinite(L))L=0;if(!isFinite(R))R=0;
      var newDcL=L,newDcR=R;
      L-=this.dcL;this.dcL+=0.000035*(newDcL-this.dcL);
      R-=this.dcR;this.dcR+=0.000035*(newDcR-this.dcR);
      var dryL=L,dryR=R;
      if(MB&&SENS>0.01){
        var gain=SENS;
        var stages=Math.max(1,Math.ceil(Math.log2(Math.max(1.01,gain))));
        var gps=Math.pow(gain,1/stages);
        for(var ss=0;ss<stages;ss++){L=this.softClip(L*gps,0.04);R=this.softClip(R*gps,0.04);}
      }
      if(GA>0.01){
        var genv=this.gateEnv.proc((Math.abs(L)+Math.abs(R))*0.5);
        var gth=0.0008+GA*0.025;
        var gg=genv<gth?(genv/gth)*(1-GA)*0.08:1;
        L*=gg;R*=gg;
      }
      L=this.softClip(L*PA,PA*0.3);
      R=this.softClip(R*PA,PA*0.3);
      if(VM===1){
        var rm=Math.sin(6.2832*this.rph);
        this.rph=(this.rph+80/sampleRate)%1;
        L*=rm;R*=rm;
      } else if(VM===2){
        L=this.softClip(L*1.6,0.35);R=this.softClip(R*1.6,0.35);
      } else if(VM===4){
        L=this.radHp2L.proc(this.radHpL.proc(this.radLpL.proc(L)));
        R=this.radHp2R.proc(this.radHpR.proc(this.radLpR.proc(R)));
        L*=2.2;R*=2.2;
      }
      var ep=PI;
      if(VM===2)ep=PI-5;
      else if(VM===3)ep=PI+7;
      else if(VM===5)ep=PI-3;
      if(Math.abs(ep)>0.05){
        var rt=Math.pow(2,this.clamp(ep,-12,12)/12);
        this.pBL[this.pw]=L;this.pBR[this.pw]=R;
        var i1=this.pr1|0,i2=this.pr2|0;
        var a1=this.pr1-i1,a2=this.pr2-i2;
        var j1=(i1+1)%this.pb,j2=(i2+1)%this.pb;
        var wf1=0.5-0.5*Math.cos(6.2832*this.ph1);
        var wf2=0.5-0.5*Math.cos(6.2832*this.ph2);
        var dd=wf1+wf2+1e-7;
        L=((this.pBL[i1]*(1-a1)+this.pBL[j1]*a1)*wf1+(this.pBL[i2]*(1-a2)+this.pBL[j2]*a2)*wf2)/dd;
        R=((this.pBR[i1]*(1-a1)+this.pBR[j1]*a1)*wf1+(this.pBR[i2]*(1-a2)+this.pBR[j2]*a2)*wf2)/dd;
        if(!isFinite(L))L=0;if(!isFinite(R))R=0;
        this.pw=(this.pw+1)%this.pb;
        this.pr1=(this.pr1+rt)%this.pb;
        this.pr2=(this.pr2+rt)%this.pb;
        this.ph1=(this.ph1+rt/512)%1;
        this.ph2=(this.ph2+rt/512)%1;
      }
      for(var ei=0;ei<10;ei++){L=this.eqL[ei].proc(L);R=this.eqR[ei].proc(R);}
      if(PR>0.01){L=this.presL.proc(L);R=this.presR.proc(R);}
      if(CL>0.01){L=this.clarL.proc(L);R=this.clarR.proc(R);}
      if(AI>0.01){L=this.airFL.proc(L);R=this.airFR.proc(R);}
      if(BS>0.01){L=this.bassL.proc(L);R=this.bassR.proc(R);}
      if(DX>0.01){
        var dL=this.distort(L,DM,DD,DT);
        var dR=this.distort(R,DM,DD,DT);
        L=L*(1-DX)+dL*DX*DO;
        R=R*(1-DX)+dR*DX*DO;
      }
      if(WW>0.01){
        var monoSig=(L+R)*0.5;
        this.haasR[this.haasPos]=monoSig;
        var haasDelay=Math.max(1,Math.round(WD*this.haasLen));
        var haasIdx=(this.haasPos+this.haasLen-haasDelay)%this.haasLen;
        var Rdelayed=this.haasR[haasIdx];
        this.haasPos=(this.haasPos+1)%this.haasLen;
        var psL=monoSig,psR=Rdelayed;
        var mid=(psL+psR)*0.5,side=(psL-psR)*0.5;
        var stereoAmt=WS*2;
        if(WM===0){
          side*=(1+WW*1.2)*stereoAmt;
        } else if(WM===1){
          side*=(1+WW*1.5)*stereoAmt;
        } else if(WM===2){
          var cmbDelay=Math.max(1,Math.round(WD*0.5*this.cmbLen));
          var ci=(this.cmbPos+this.cmbLen-cmbDelay)%this.cmbLen;
          var cmbOut=this.cmbBuf[ci];
          this.cmbBuf[this.cmbPos]=side+cmbOut*WW*0.25;
          this.cmbPos=(this.cmbPos+1)%this.cmbLen;
          side=(side+cmbOut*WW)*(1+WW*1.3)*stereoAmt;
        } else {
          side*=(1+WW*2)*stereoAmt;
          side+=this.softClip(side*WW*0.3,0.15);
        }
        var wL=mid+side,wR=mid-side;
        var wBlend=Math.min(1,WW);
        L=monoSig*(1-wBlend)+wL*wBlend;
        R=monoSig*(1-wBlend)+wR*wBlend;
        L=this.softClip(L,0.08);R=this.softClip(R,0.08);
      }
      if(RW>0.01){
        var rv=this.doReverb(L,R,RW,RD,RR,RP,RDMP);
        L=rv.L;R=rv.R;
      }
      if(EW>0.01){
        var dt2=Math.min(this.ecLen-1,Math.round(ET*sampleRate));
        var ei2=(this.ecPos+this.ecLen-dt2)%this.ecLen;
        var edL=this.ecL[ei2],edR=this.ecR[ei2];
        this.ecL[this.ecPos]=L+edL*EF;
        this.ecR[this.ecPos]=R+edR*EF;
        this.ecPos=(this.ecPos+1)%this.ecLen;
        L=L*(1-EW)+edL*EW;
        R=R*(1-EW)+edR*EW;
      }
      if(G1E){var gl1=Math.pow(10,this.clamp(GS1,-12,24)/20);L=this.softClip(L*gl1,0.2);R=this.softClip(R*gl1,0.2);}
      if(G2E){var gl2=Math.pow(10,this.clamp(GS2,-12,24)/20);L=this.softClip(L*gl2,0.2);R=this.softClip(R*gl2,0.2);}
      if(G3E){var gl3=Math.pow(10,this.clamp(GS3,-12,24)/20);L=this.softClip(L*gl3,0.2);R=this.softClip(R*gl3,0.2);}
      if(G4E){var gl4=Math.pow(10,this.clamp(GS4,-12,24)/20);L=this.softClip(L*gl4,0.2);R=this.softClip(R*gl4,0.2);}
      if(G5E){var gl5=Math.pow(10,this.clamp(GS5,-12,24)/20);L=this.softClip(L*gl5,0.2);R=this.softClip(R*gl5,0.2);}
      if(!isFinite(L))L=0;if(!isFinite(R))R=0;
      if(MG>1.001){
      var stages2=MG>1000?5:MG>100?4:MG>10?3:2;
      var gps2=Math.pow(MG,1/stages2);
      for(var ss2=0;ss2<stages2;ss2++){
       L=this.softClip(L*gps2,0.45);
      R=this.softClip(R*gps2,0.45);
  }
}
      if(BT>1.001){
        L=this.softClip(L*BT,0.28);
        R=this.softClip(R*BT,0.28);
      }
      if(CO>0.01){
        var cv=(Math.abs(L)+Math.abs(R))*0.5;
        var cEnv=this.compEnv.proc(cv);
        var over=Math.max(0,cEnv-0.055);
        var gr=1/(1+over*(8+CO*18));
        var makeup=1+CO*0.6;
        L=this.softClip(L*makeup*gr,0.12);
        R=this.softClip(R*makeup*gr,0.12);
      }
      if(MIX<0.999){
        L=dryL*(1-MIX)+L*MIX;
        R=dryR*(1-MIX)+R*MIX;
      }
      L=this.limitSample(isFinite(L)?L:0);
      R=this.limitSample(isFinite(R)?R:0);
      o0[0][i]=L;
      if(o0[1])o0[1][i]=R;
    }
    return true;
  }
}
registerProcessor('rexx-engine',RexxEngine);
`;

/* ─── CHAIN ───────────────────────────────────────────────────── */
var CHAIN={
  node:null,an:null,mon:null,_src:null,_dest:null,
  mp3Src:null,mp3Gain:null,mp3MixGain:null,
  _startTime:Date.now(),
  loadWorklet:function(ctx,src,dest){
    var self=this;this._src=src;this._dest=dest;
    var blob=new Blob([WK],{type:'application/javascript'});
    ctx.audioWorklet.addModule(URL.createObjectURL(blob)).then(function(){
      self.node=new AudioWorkletNode(ctx,'rexx-engine',{
        numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[2],
        channelCount:2,channelCountMode:'explicit',channelInterpretation:'discrete'
      });
      try{src.disconnect(dest);}catch(e){}
      src.connect(self.node);
self.postGain=ctx.createGain();
self.postGain.gain.value=100;
self.postGain2=ctx.createGain();
self.postGain2.gain.value=5;
self.node.connect(self.postGain);
self.postGain3=ctx.createGain();
self.postGain3.gain.value=2;
self.postGain.connect(self.postGain2);
self.postGain2.connect(self.postGain3);
self.postGain3.connect(dest);
      self.an=ctx.createAnalyser();
      self.an.fftSize=2048;self.an.smoothingTimeConstant=0.8;
      self.node.connect(self.an);
      self.mon=ctx.createGain();self.mon.gain.value=0;
      self.node.connect(self.mon);self.mon.connect(ctx.destination);
      self.update();
      setStatus('ACTIVE','#22c55e');setMicStatus(true);
    }).catch(function(e){console.error('[Rexx]',e);setStatus('ERR','#f87171');});
  },
  tryInject:function(stream){
    var ctx=window.__RexxCtx;
    if(!ctx){setTimeout(function(){CHAIN.tryInject(stream);},300);return;}
    var src=ctx.createMediaStreamSource(stream),dest=ctx.createMediaStreamDestination();
    src.connect(dest);this.loadWorklet(ctx,src,dest);
  },
  setMon:function(on){
    ST.monOn=on;
    if(!this.mon||!window.__RexxCtx)return;
    this.mon.gain.setTargetAtTime(on?ST.monVol:0,window.__RexxCtx.currentTime,0.05);
  },
  set:function(name,val){
    if(!this.node||!window.__RexxCtx)return;
    var pm=this.node.parameters.get(name);
    if(pm)pm.setTargetAtTime(isFinite(val)?val:0,window.__RexxCtx.currentTime,0.03);
  },
  update:function(){
    if(!this.node)return;
    var c=function(v,a,b){var n=+v;return isFinite(n)?Math.max(a,Math.min(b,n)):a;};
    this.set('on',ST.on?1:0);
    this.set('sensitivity',c(ST.sensitivity,0,3));
    this.set('micBoost',ST.micBoostOn?1:0);
    this.set('preAmp',1+c(ST.preAmp,0,1)*20); // 1x..21x, matches worklet's preAmp maxValue
    /* masterGain: UI slider is 0-20 "Loud" units. We map that to a real,
       always-finite linear gain, hard-clamped to the worklet's own
       parameterDescriptors maxValue (9999, ~80dB) so it can never reach
       NaN/Infinity no matter what the slider or a bad preset says. The
       displayed number (see updateGainLabel) can still read into the
       millions purely as a label — the actual signal is always run
       through this same safe, clamped multiplier plus the limiter. */
    var mg=Math.pow(10,c(ST.masterGain,0,20)*4/20);   // 10^0..10^4 = 1x..10000x
    mg=isFinite(mg)?Math.min(9999,Math.max(1,mg)):1;
    this.set('masterGain',mg);
    this.set('boost',1+c(ST.boost,0,1)*25); // 1x..26x, matches worklet's boost maxValue
    this.set('mix',c(ST.mix,0,1));
    this.set('gate',c(ST.gate,0,1));
    this.set('comp',c(ST.comp,0,1));
    this.set('presence',c(ST.presence,0,1));
    this.set('clarity',c(ST.clarity,0,1));
    this.set('air',c(ST.air,0,1));
    this.set('bass',c(ST.bass,0,1));
    this.set('pitch',c(ST.pitch,-12,12));
    this.set('voiceMode',c(ST.voiceMode,0,5));
    this.set('distMode',c(ST.distMode,0,5));
    this.set('distDrive',c(ST.distDrive,0,1));
    this.set('distTone',c(ST.distTone,0,1));
    this.set('distMix',c(ST.distMix,0,1));
    this.set('distOut',c(ST.distOut,0,2));
    this.set('widerMode',c(ST.widerMode,0,3));
    this.set('widerWidth',c(ST.widerWidth,0,2));
    this.set('widerDepth',c(ST.widerDepth,0,1));
    this.set('widerStereo',c(ST.widerStereo,0,1));
    this.set('reverbWet',c(ST.reverbWet,0,1));
    this.set('reverbDecay',c(ST.reverbDecay,0.1,10));
    this.set('reverbRoom',c(ST.reverbRoom,0.1,4));
    this.set('reverbPre',c(ST.reverbPre,0,0.1));
    this.set('reverbDamp',c(ST.reverbDamp,0,1));
    this.set('echoWet',c(ST.echoWet,0,1));
    this.set('echoTime',c(ST.echoTime,0.01,1));
    this.set('echoFb',c(ST.echoFb,0,0.9));
    for(var i=0;i<10;i++)this.set('eq'+i,c(ST.eq[i],-12,12));
    for(var gi=0;gi<5;gi++){
      this.set('gs'+(gi+1),c(ST.gainStages[gi],-12,24));
      this.set('gs'+(gi+1)+'En',ST.gainStageOn[gi]?1:0);
    }
  },
  connectMP3:function(ctx,buf){
    if(this.mp3Src){try{this.mp3Src.stop();}catch(e){}}
    if(!this.mp3Gain){
      this.mp3Gain=ctx.createGain();
      this.mp3Gain.gain.value=ST.mp3Vol;
      this.mp3MixGain=ctx.createGain();
      this.mp3MixGain.gain.value=ST.mp3MicMix;
      this.mp3Gain.connect(this.mp3MixGain);
      if(this.node)this.mp3MixGain.connect(this.node);
      else if(this._dest)this.mp3MixGain.connect(this._dest);
    }
    var src=ctx.createBufferSource();
    src.buffer=buf;src.loop=true;
    src.connect(this.mp3Gain);src.start(0);
    this.mp3Src=src;return src;
  },
  setMP3Vol:function(v){
    if(this.mp3Gain&&window.__RexxCtx)
      this.mp3Gain.gain.setTargetAtTime(v,window.__RexxCtx.currentTime,0.05);
    ST.mp3Vol=v;saveState();
  },
  setMP3Mix:function(v){
    if(this.mp3MixGain&&window.__RexxCtx)
      this.mp3MixGain.gain.setTargetAtTime(v,window.__RexxCtx.currentTime,0.05);
    ST.mp3MicMix=v;saveState();
  }
};

/* ─── AUDIO PATCHES ───────────────────────────────────────────── */
var _NAC=window.AudioContext||window.webkitAudioContext;
if(_NAC){
  window.AudioContext=function(o){
    var ctx=new _NAC(Object.assign({latencyHint:'interactive',sampleRate:48000},o||{}));
    if(!window.__RexxCtx)window.__RexxCtx=ctx;
    return ctx;
  };
  window.AudioContext.prototype=_NAC.prototype;
  if(window.webkitAudioContext)window.webkitAudioContext=window.AudioContext;
}
var _gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
navigator.mediaDevices.getUserMedia=function(c){
  if(c&&c.audio){
    var dev=(typeof c.audio==='object'&&c.audio.deviceId)||undefined;
    // StereoLoudMic OFF entirely: hand the call back to a completely
    // normal getUserMedia request (no forced constraints at all), so
    // Discord's mic behaves exactly as if this plugin didn't exist.
    if(!ST.on){
      return _gum(c);
    }
    // Ask for real stereo when Stereo is ON. `ideal` (not `exact`) so
    // this still works on phones/mics that only have one channel —
    // it just won't invent a second one (see requirement: never fake
    // stereo by duplicating mono).
    c.audio={
      deviceId:dev,
      echoCancellation:false,
      noiseSuppression:false,
      autoGainControl:false,
      sampleRate:48000,
      channelCount: ST.stereoOn ? {ideal:2} : {ideal:1}
    };
  }
  return _gum(c).then(function(stream){
    if(!c||!c.audio)return stream;
    setMicStatus(true);
    var ctx=window.__RexxCtx;
    if(!ctx){setTimeout(function(){CHAIN.tryInject(stream);},500);return stream;}
    var src=ctx.createMediaStreamSource(stream),dest=ctx.createMediaStreamDestination();
    // Force both nodes to actually carry 2 discrete channels end-to-end
    // instead of letting the default "max"/"speakers" mixing rules
    // silently fold a stereo track down to mono anywhere in the graph.
    src.channelCount=2;src.channelCountMode='explicit';src.channelInterpretation='discrete';
    dest.channelCount=2;dest.channelCountMode='explicit';dest.channelInterpretation='discrete';
    src.connect(dest);CHAIN.loadWorklet(ctx,src,dest);
    return dest.stream;
  }).catch(function(e){console.warn('[StereoLoudMic gum]',e);setMicStatus(false);return _gum(c);});
};

/* ─── HELPERS ─────────────────────────────────────────────────── */
function setStatus(t,color){var el=document.getElementById('rx-status');if(el){el.textContent=t;el.style.color=color||'#f59e0b';}}
function setMicStatus(on){
  ['rx-micdot','rx-micdot2'].forEach(function(id){var d=document.getElementById(id);if(d)d.style.background=on?'#22c55e':'#4b5563';});
  var t=document.getElementById('rx-mictext');if(t)t.textContent=on?'Connected':'Waiting...';
  var t2=document.getElementById('rx-micfoot');if(t2)t2.textContent=on?'Mic: Connected':'Mic: Waiting';
}

/* ─── CSS ─────────────────────────────────────────────────────── */
var CSS=`
@keyframes rcPulse{0%,100%{box-shadow:0 0 0 0 rgba(124,58,237,.5);}50%{box-shadow:0 0 0 8px rgba(124,58,237,0);}}
@keyframes rcPop{from{opacity:0;transform:scale(.96);}to{opacity:1;transform:scale(1);}}
@keyframes rcSlide{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:translateY(0);}}
@keyframes rcBars{0%,100%{transform:scaleY(.4);}50%{transform:scaleY(1);}}

#rc-fab{all:initial;position:fixed;bottom:24px;right:24px;z-index:2147483646;
  width:56px;height:56px;border-radius:50%;cursor:pointer;
  background:linear-gradient(135deg,#5b21b6,#7c3aed);
  border:2px solid rgba(167,139,250,.4);
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 24px rgba(124,58,237,.5);
  transition:transform .18s,box-shadow .18s;animation:rcPulse 2.5s ease-in-out infinite;}
#rc-fab:hover{transform:scale(1.1);box-shadow:0 6px 32px rgba(124,58,237,.7);}
#rc-fab svg{width:26px;height:26px;}

#rc{all:initial;display:flex;flex-direction:column;
  position:fixed;top:36px;left:36px;z-index:2147483647;
  width:1000px;height:660px;
  font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
  font-size:13px;color:#e2e8f0;
  background:#0f0f1a;border-radius:14px;overflow:hidden;
  box-shadow:0 16px 60px rgba(0,0,0,.95),0 0 0 1px rgba(124,58,237,.2);
  animation:rcPop .2s ease;}
#rc *{box-sizing:border-box;}
@media(max-width:1020px){
  #rc{top:0!important;left:0!important;width:100vw!important;height:100dvh!important;border-radius:0;}
  .rc-sidebar{width:52px!important;padding:8px 4px!important;}
  .rc-nav span{display:none!important;}
  .rc-nav{justify-content:center!important;padding:10px 0!important;}
}

/* Title bar */
.rc-title{display:flex;align-items:center;height:44px;padding:0 16px;
  background:#0f0f1a;border-bottom:1px solid rgba(124,58,237,.15);
  cursor:move;user-select:none;flex-shrink:0;gap:8px;}
.rc-logo{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:700;color:#fff;letter-spacing:-.3px;}
.rc-logo-icon{width:22px;height:22px;flex-shrink:0;}
.rc-logo em{color:#8b5cf6;font-style:normal;}
.rc-spacer{flex:1;}
.rc-status-badge{font-size:9px;font-family:monospace;padding:3px 9px;border-radius:20px;
  background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.07);color:#f59e0b;}
.rc-wbtn{width:28px;height:28px;border-radius:7px;cursor:pointer;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);
  color:rgba(255,255,255,.45);font-size:12px;margin-left:4px;
  display:flex;align-items:center;justify-content:center;transition:all .15s;}
.rc-wbtn:hover{background:rgba(255,255,255,.1);color:#fff;}
.rc-wbtn.cls:hover{background:rgba(239,68,68,.2);color:#fca5a5;}

/* Layout */
.rc-body{display:flex;flex:1;overflow:hidden;}
.rc-sidebar{width:170px;flex-shrink:0;background:#0f0f1a;
  border-right:1px solid rgba(124,58,237,.12);
  display:flex;flex-direction:column;padding:10px 8px;overflow-y:auto;}
.rc-sidebar::-webkit-scrollbar{width:2px;}
.rc-sidebar::-webkit-scrollbar-thumb{background:rgba(124,58,237,.3);}
.rc-nav{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;
  cursor:pointer;color:rgba(255,255,255,.4);font-size:12px;font-weight:500;
  transition:all .15s;margin-bottom:2px;border:1px solid transparent;white-space:nowrap;}
.rc-nav:hover{color:rgba(255,255,255,.75);background:rgba(255,255,255,.05);}
.rc-nav.active{background:#7c3aed;color:#fff;border-color:rgba(167,139,250,.3);
  box-shadow:0 2px 14px rgba(124,58,237,.4);}
.rc-nav svg{width:16px;height:16px;flex-shrink:0;}
.rc-sidebar-foot{margin-top:auto;padding:10px;border-top:1px solid rgba(124,58,237,.1);}
.rc-mic-row{display:flex;align-items:center;gap:5px;}
.rc-mic-dot{width:7px;height:7px;border-radius:50%;background:#374151;flex-shrink:0;transition:background .3s;}
.rc-mic-dot.on{background:#22c55e;}
.rc-mic-label{font-size:10px;color:rgba(255,255,255,.35);}
.rc-foot-sub{font-size:9px;color:rgba(255,255,255,.18);margin-top:2px;}

/* Content */
.rc-content{flex:1;overflow-y:auto;overflow-x:hidden;background:#13131f;position:relative;}
.rc-content::-webkit-scrollbar{width:4px;}
.rc-content::-webkit-scrollbar-thumb{background:rgba(124,58,237,.3);border-radius:4px;}
.rc-page{display:none;flex-direction:column;animation:rcSlide .18s ease;}
.rc-page.active{display:flex;}

/* Cards */
.rc-card{margin:8px 10px;border-radius:12px;
  border:1px solid rgba(255,255,255,.06);background:#1a1a2e;overflow:hidden;}
.rc-card-head{display:flex;align-items:center;justify-content:space-between;padding:11px 14px 9px;}
.rc-card-title{font-size:13px;font-weight:600;color:rgba(255,255,255,.85);}

/* Status card */
.rc-status-card{display:flex;align-items:center;gap:14px;padding:12px 14px;
  margin:8px 10px;border-radius:12px;
  border:1px solid rgba(124,58,237,.2);background:linear-gradient(135deg,#1a1a2e,#1e1535);}
.rc-status-left{display:flex;flex-direction:column;gap:3px;min-width:140px;}
.rc-status-title{font-size:13px;font-weight:700;color:#fff;}
.rc-mic-status{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:500;}
.rc-status-right{display:flex;flex-direction:column;gap:4px;flex:1;}
.rc-level-label{font-size:9px;color:rgba(255,255,255,.35);letter-spacing:.5px;text-transform:uppercase;}
.rc-led-row{display:flex;align-items:center;gap:2px;}
.rc-led{width:10px;height:12px;border-radius:2px;background:rgba(255,255,255,.05);transition:background .05s;}
.rc-led.lit{background:#7c3aed;}.rc-led.lit-y{background:#a78bfa;}.rc-led.lit-r{background:#f43f5e;}
.rc-led-pct{font-size:11px;color:rgba(255,255,255,.4);margin-left:6px;font-family:monospace;min-width:32px;}

/* Toggle */
.rc-toggle{position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;flex-shrink:0;}
.rc-toggle input{opacity:0;width:0;height:0;position:absolute;}
.rc-toggle-slider{position:absolute;inset:0;border-radius:24px;
  background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.1);transition:all .2s;}
.rc-toggle input:checked~.rc-toggle-slider{background:#7c3aed;border-color:rgba(167,139,250,.5);}
.rc-toggle-slider:before{content:'';position:absolute;width:18px;height:18px;border-radius:50%;
  background:#fff;top:2px;left:2px;transition:transform .2s;box-shadow:0 1px 4px rgba(0,0,0,.4);}
.rc-toggle input:checked~.rc-toggle-slider:before{transform:translateX(20px);}

/* Vertical sliders */
.rc-vsliders{display:flex;justify-content:space-around;padding:10px 14px 8px;gap:8px;}
.rc-vsw{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;}
.rc-vs-track-wrap{position:relative;height:110px;width:36px;display:flex;align-items:center;justify-content:center;overflow:visible;}
.rc-vs-track{position:absolute;left:50%;transform:translateX(-50%);width:4px;height:110px;background:rgba(255,255,255,.08);border-radius:4px;}
.rc-vs-fill{position:absolute;bottom:0;left:0;right:0;border-radius:4px;background:linear-gradient(to top,#5b21b6,#8b5cf6,#c4b5fd);transition:height .04s;}
.rc-vs-thumb{position:absolute;left:50%;transform:translateX(-50%);width:20px;height:9px;background:#a78bfa;border-radius:4px;border:2px solid #e9d5ff;box-shadow:0 0 10px rgba(167,139,250,.7);pointer-events:none;transition:bottom .04s;}
.rc-vs-inp{position:absolute;opacity:0;cursor:pointer;width:110px;height:36px;
  transform:rotate(-90deg);transform-origin:center center;
  top:calc(50% - 18px);left:calc(50% - 55px);}
.rc-vs-name{font-size:10px;color:rgba(255,255,255,.45);text-align:center;white-space:nowrap;font-weight:500;}
.rc-vs-val{font-size:10px;font-weight:600;color:#e2e8f0;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);
  border-radius:6px;padding:3px 8px;text-align:center;min-width:50px;}

/* Horizontal sliders */
.rc-hrow{display:flex;align-items:center;gap:12px;padding:6px 14px;}
.rc-hrow-lbl{font-size:11px;color:rgba(255,255,255,.5);min-width:90px;flex-shrink:0;}
.rc-hsli{-webkit-appearance:none;appearance:none;height:4px;flex:1;border-radius:3px;
  background:rgba(255,255,255,.09);outline:none;cursor:pointer;}
.rc-hsli::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;
  background:#8b5cf6;border:2px solid #c4b5fd;cursor:pointer;
  box-shadow:0 0 0 3px rgba(124,58,237,.15),0 0 8px rgba(139,92,246,.4);transition:transform .1s;}
.rc-hsli::-webkit-slider-thumb:active{transform:scale(1.28);}
.rc-hval{font-size:10px;color:#a78bfa;min-width:42px;text-align:right;font-family:monospace;font-weight:600;}

/* EQ bands */
.rc-eq-area{display:flex;gap:0;padding:4px 14px 6px;}
.rc-eq-labels{display:flex;flex-direction:column;justify-content:space-between;width:38px;flex-shrink:0;padding-bottom:20px;}
.rc-eq-label{font-size:9px;color:rgba(255,255,255,.3);}
.rc-eq-bands{display:flex;flex:1;justify-content:space-between;}
.rc-eq-band{display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;}
.rc-eq-track{position:relative;height:110px;width:4px;background:rgba(255,255,255,.09);border-radius:4px;}
.rc-eq-fill-top{position:absolute;left:0;right:0;border-radius:4px 4px 0 0;background:rgba(139,92,246,.65);}
.rc-eq-fill-bot{position:absolute;left:0;right:0;bottom:0;border-radius:0 0 4px 4px;background:rgba(139,92,246,.65);}
.rc-eq-thumb{position:absolute;left:50%;transform:translateX(-50%);width:16px;height:8px;background:#8b5cf6;border-radius:3px;border:1.5px solid #c4b5fd;box-shadow:0 0 8px rgba(139,92,246,.5);}
.rc-eq-sli{position:absolute;opacity:0;cursor:pointer;z-index:2;
  width:110px;height:32px;
  transform:rotate(-90deg);transform-origin:center center;
  top:calc(50% - 16px);left:calc(50% - 55px);}
.rc-eq-lbl{font-size:8px;color:rgba(255,255,255,.3);text-align:center;white-space:nowrap;}

/* EQ bottom bar */
.rc-eq-bot{display:flex;align-items:center;gap:8px;padding:8px 14px;
  border-top:1px solid rgba(255,255,255,.05);background:#0f0f1a;flex-shrink:0;flex-wrap:wrap;}
.rc-eq-bot select{padding:4px 8px;border-radius:6px;font-size:11px;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);
  color:#e2e8f0;outline:none;cursor:pointer;}
.rc-eq-bot select option{background:#1a1a2e;color:#e2e8f0;}

/* Icon buttons */
.rc-icon-btn{width:28px;height:28px;border-radius:7px;cursor:pointer;
  border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);
  color:rgba(255,255,255,.45);font-size:12px;
  display:flex;align-items:center;justify-content:center;transition:all .15s;}
.rc-icon-btn:hover{background:rgba(255,255,255,.1);color:#fff;}

/* Mini slider */
.rc-mini-sli{-webkit-appearance:none;height:4px;width:100px;border-radius:3px;
  background:rgba(255,255,255,.09);outline:none;cursor:pointer;}
.rc-mini-sli::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;
  background:#8b5cf6;border:2px solid #c4b5fd;cursor:pointer;transition:transform .1s;}
.rc-mini-sli::-webkit-slider-thumb:active{transform:scale(1.2);}
.rc-mini-val{font-size:11px;color:rgba(255,255,255,.5);font-family:monospace;font-weight:600;}

/* Mode row */
.rc-mode-row{display:flex;flex-wrap:wrap;gap:5px;padding:6px 14px 8px;}
.rc-mbtn{padding:5px 12px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:rgba(255,255,255,.45);
  transition:all .15s;}
.rc-mbtn:hover{background:rgba(255,255,255,.09);}
.rc-mbtn.active{background:rgba(124,58,237,.25);border-color:rgba(167,139,250,.4);color:#ddd6fe;}

/* Sec label */
.rc-sec-lbl{font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:rgba(255,255,255,.22);padding:6px 14px 3px;}

/* Voice grid */
.rc-vc-cats{display:flex;flex-wrap:wrap;gap:4px;padding:8px 10px 4px;}
.rc-cat-btn{padding:4px 10px;border-radius:20px;font-size:10px;font-weight:600;cursor:pointer;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:rgba(255,255,255,.45);
  transition:all .15s;}
.rc-cat-btn:hover{background:rgba(255,255,255,.09);}
.rc-cat-btn.active{background:rgba(124,58,237,.25);border-color:rgba(167,139,250,.35);color:#ddd6fe;}
.rc-vc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;padding:4px 10px 10px;}
.rc-vc-btn{display:flex;flex-direction:column;align-items:center;gap:3px;
  padding:9px 5px;border-radius:9px;cursor:pointer;text-align:center;
  border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.025);
  color:rgba(255,255,255,.5);font-size:10px;font-weight:500;
  transition:all .15s;line-height:1.2;}
.rc-vc-btn:hover{background:rgba(255,255,255,.06);color:rgba(255,255,255,.8);transform:translateY(-1px);}
.rc-vc-btn.active{background:rgba(124,58,237,.22);border-color:rgba(167,139,250,.4);color:#ddd6fe;
  box-shadow:0 2px 12px rgba(124,58,237,.3);}
.rc-vc-icon{font-size:20px;display:block;}

/* Quick Voice grid */
.rc-qv-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:8px 10px 10px;}
.rc-qv-btn{display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:11px 6px;border-radius:10px;cursor:pointer;text-align:center;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);
  color:rgba(255,255,255,.55);font-size:11px;font-weight:600;transition:all .15s;}
.rc-qv-btn:hover{background:rgba(255,255,255,.07);color:#fff;transform:translateY(-1px);}
.rc-qv-btn.active{background:rgba(124,58,237,.25);border-color:rgba(167,139,250,.4);color:#ddd6fe;
  box-shadow:0 2px 12px rgba(124,58,237,.35);}
.rc-qv-icon{font-size:22px;display:block;}

/* Reverb presets */
.rc-rp-row{display:flex;gap:5px;flex-wrap:wrap;padding:5px 14px 8px;}
.rc-rpbtn{padding:4px 11px;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;
  border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:rgba(255,255,255,.45);
  transition:all .15s;}
.rc-rpbtn:hover{background:rgba(255,255,255,.09);}
.rc-rpbtn.active{background:rgba(124,58,237,.22);border-color:rgba(167,139,250,.35);color:#ddd6fe;}

/* Preset items */
.rc-preset-item{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.04);}
.rc-preset-name{flex:1;font-size:11px;color:rgba(255,255,255,.65);}
.rc-pbtn{padding:4px 10px;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;
  border:1px solid rgba(139,92,246,.3);background:rgba(124,58,237,.12);color:#c4b5fd;transition:all .15s;}
.rc-pbtn:hover{background:rgba(124,58,237,.28);}
.rc-pbtn.del{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.25);color:#fca5a5;}
.rc-pbtn.del:hover{background:rgba(239,68,68,.2);}

/* MP3 */
.rc-upload-zone{margin:8px 10px;border:2px dashed rgba(139,92,246,.22);border-radius:10px;
  padding:22px;text-align:center;cursor:pointer;
  color:rgba(255,255,255,.28);font-size:11px;transition:all .2s;}
.rc-upload-zone:hover{border-color:rgba(139,92,246,.5);color:rgba(255,255,255,.55);}
.rc-mp3-icon{font-size:28px;margin-bottom:8px;}

/* Stats */
.rc-stat-row{display:flex;align-items:center;gap:8px;padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.04);}
.rc-stat-lbl{font-size:11px;color:rgba(255,255,255,.38);min-width:120px;}
.rc-stat-val{font-size:11px;font-weight:600;color:#a78bfa;font-family:monospace;}

/* Chain indicator rows */
.rc-chain-row{display:flex;align-items:center;gap:8px;padding:6px 14px;}
.rc-chain-dot{width:7px;height:7px;border-radius:50%;background:#374151;flex-shrink:0;}
.rc-chain-name{font-size:11px;color:rgba(255,255,255,.5);flex:1;}
.rc-chain-val{font-size:10px;font-weight:600;font-family:monospace;color:rgba(255,255,255,.25);}

/* Boost card */
.rc-boost-card{margin:0 10px 8px;padding:12px 14px;border-radius:10px;
  border:1px solid rgba(167,139,250,.22);background:rgba(124,58,237,.07);display:none;}
.rc-boost-card.show{display:block;}
.rc-boost-title{font-size:12px;font-weight:600;color:#c4b5fd;margin-bottom:8px;}
.rc-boost-hint{font-size:10px;color:rgba(255,255,255,.3);margin-top:6px;line-height:1.6;}

/* Gain Rack */
.rc-gr-wrap{display:flex;gap:0;padding:10px 14px 12px;justify-content:space-between;}
.rc-gs-col{display:flex;flex-direction:column;align-items:center;gap:6px;flex:1;min-width:0;}
.rc-gs-header{display:flex;align-items:center;justify-content:center;gap:4px;min-height:28px;}
.rc-gs-num{font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:rgba(255,255,255,.3);text-align:center;}
.rc-gs-track-wrap{position:relative;height:140px;width:36px;display:flex;align-items:center;justify-content:center;overflow:visible;}
.rc-gs-track{position:absolute;left:50%;transform:translateX(-50%);width:4px;height:140px;background:rgba(255,255,255,.08);border-radius:4px;}
.rc-gs-fill-top{position:absolute;bottom:50%;left:0;right:0;border-radius:4px 4px 0 0;background:linear-gradient(to top,#22c55e,#86efac);}
.rc-gs-fill-bot{position:absolute;top:50%;left:0;right:0;border-radius:0 0 4px 4px;background:linear-gradient(to bottom,#f59e0b,#fcd34d);}
.rc-gs-zero{position:absolute;left:-4px;right:-4px;top:50%;height:1px;background:rgba(255,255,255,.2);}
.rc-gs-thumb{position:absolute;left:50%;transform:translateX(-50%);width:22px;height:9px;background:#a78bfa;border-radius:4px;border:2px solid #e9d5ff;box-shadow:0 0 10px rgba(167,139,250,.7);pointer-events:none;}
.rc-gs-inp{position:absolute;opacity:0;cursor:pointer;width:140px;height:36px;transform:rotate(-90deg);transform-origin:center center;top:calc(50% - 18px);left:calc(50% - 70px);}
.rc-gs-val{font-size:9px;font-weight:700;color:#e2e8f0;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:5px;padding:2px 5px;text-align:center;min-width:52px;font-family:monospace;}
.rc-gs-rst{font-size:9px;padding:2px 7px;border-radius:5px;cursor:pointer;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:rgba(255,255,255,.35);transition:all .15s;}
.rc-gs-rst:hover{background:rgba(255,255,255,.1);color:#fff;}
.rc-gs-dis{opacity:.35;}

/* Gain Rack Meter */
.rc-gr-meter{margin:0 10px 8px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:#0f0f1a;padding:12px 14px;}
.rc-gr-meter-title{font-size:11px;font-weight:600;color:rgba(255,255,255,.65);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;}
.rc-gr-peak-val{font-family:monospace;font-size:11px;font-weight:700;color:#f43f5e;}
.rc-gr-bar-wrap{display:flex;gap:6px;align-items:flex-end;}
.rc-gr-bar-lbl{font-size:9px;color:rgba(255,255,255,.3);writing-mode:vertical-lr;transform:rotate(180deg);flex-shrink:0;}
.rc-gr-led-col{display:flex;flex-direction:column-reverse;gap:2px;flex:1;}
.rc-gr-led{height:6px;border-radius:2px;background:rgba(255,255,255,.05);transition:background .04s;}
.rc-gr-led.g{background:#22c55e;}.rc-gr-led.y{background:#f59e0b;}.rc-gr-led.r{background:#f43f5e;}
.rc-gr-peak-bar{width:8px;display:flex;flex-direction:column-reverse;gap:2px;align-items:center;}
.rc-gr-peak-led{width:6px;height:6px;border-radius:2px;background:rgba(255,255,255,.04);}
.rc-gr-peak-led.p{background:#f43f5e;box-shadow:0 0 6px rgba(244,63,94,.8);}
.rc-gr-stats{display:flex;gap:16px;margin-top:8px;flex-wrap:wrap;}
.rc-gr-stat{font-size:9px;color:rgba(255,255,255,.35);}
.rc-gr-stat span{color:#a78bfa;font-family:monospace;font-weight:600;}

/* Collapsed */
#rc.coll .rc-body{display:none;}
#rc.coll{height:44px;}

/* Circular waveform visualizer */
#rc-viz{position:fixed;bottom:24px;right:92px;z-index:2147483645;
  width:56px;height:56px;border-radius:50%;
  background:linear-gradient(135deg,#1a0e35,#2d1a6e);
  border:2px solid rgba(124,58,237,.4);
  display:none;align-items:center;justify-content:center;
  box-shadow:0 4px 20px rgba(124,58,237,.4);}
#rc-viz.show{display:flex;}
#rc-viz svg{width:32px;height:32px;}
.rc-viz-bar{transform-origin:center bottom;transition:transform .06s;}
`;

/* ─── UI HELPERS ──────────────────────────────────────────────── */
function setStatus(t,color){var el=document.getElementById('rc-status');if(el){el.textContent=t;el.style.color=color||'#f59e0b';}}
function setMicStatus(on){
  document.querySelectorAll('.rc-mic-dot').forEach(function(d){d.classList.toggle('on',on);});
  var t=document.getElementById('rc-mictext');if(t)t.textContent=on?'Connected':'Waiting...';
  var t2=document.getElementById('rc-mictext2');if(t2)t2.textContent=on?'Mic: Connected':'Mic: Waiting';
}

function mkToggle(id,checked,onChange){
  var lbl=document.createElement('label');lbl.className='rc-toggle';
  var inp=document.createElement('input');inp.type='checkbox';if(id)inp.id=id;inp.checked=!!checked;
  var sl=document.createElement('div');sl.className='rc-toggle-slider';
  lbl.append(inp,sl);
  inp.addEventListener('change',function(){onChange(inp.checked);});
  return{el:lbl,inp:inp};
}

function mkVSlider(opts){
  var wrap=document.createElement('div');wrap.className='rc-vsw';
  var tw=document.createElement('div');tw.className='rc-vs-track-wrap';
  var track=document.createElement('div');track.className='rc-vs-track';
  var fill=document.createElement('div');fill.className='rc-vs-fill';
  var thumb=document.createElement('div');thumb.className='rc-vs-thumb';
  var sli=document.createElement('input');
  sli.type='range';sli.className='rc-vs-inp';
  sli.min=opts.min||0;sli.max=opts.max||1;sli.step=opts.step||0.01;sli.value=opts.value||0;
  function upd(){var pct=(sli.value-sli.min)/(sli.max-sli.min)*100;fill.style.height=pct.toFixed(1)+'%';thumb.style.bottom='calc('+pct.toFixed(1)+'% - 4px)';}
  upd();
  var valBox=document.createElement('div');valBox.className='rc-vs-val';
  var namEl=document.createElement('div');namEl.className='rc-vs-name';namEl.textContent=opts.label;
  function fmtV(){return opts.fmt?opts.fmt(parseFloat(sli.value)):Math.round(parseFloat(sli.value)*100)+'%';}
  valBox.textContent=fmtV();
  sli.addEventListener('input',function(){upd();valBox.textContent=fmtV();if(opts.onChange)opts.onChange(parseFloat(sli.value));});
  track.append(fill,thumb,sli);tw.appendChild(track);
  wrap.append(tw,namEl,valBox);
  wrap._sli=sli;wrap._upd=upd;wrap._val=valBox;
  return wrap;
}

function mkHSlider(opts){
  var row=document.createElement('div');row.className='rc-hrow';
  var lbl=document.createElement('span');lbl.className='rc-hrow-lbl';lbl.textContent=opts.label;
  var sli=document.createElement('input');
  sli.type='range';sli.className='rc-hsli';
  sli.min=opts.min||0;sli.max=opts.max||1;sli.step=opts.step||0.01;sli.value=opts.value||0;
  if(opts.id)sli.id=opts.id;
  function fillSli(){var p=((sli.value-sli.min)/(sli.max-sli.min)*100).toFixed(1);sli.style.background='linear-gradient(to right,#7c3aed '+p+'%,rgba(255,255,255,.09) '+p+'%)';}
  fillSli();
  var valEl=document.createElement('span');valEl.className='rc-hval';
  valEl.textContent=opts.fmt?opts.fmt(parseFloat(sli.value)):'';
  sli.addEventListener('input',function(){fillSli();valEl.textContent=opts.fmt?opts.fmt(parseFloat(sli.value)):'';if(opts.onChange)opts.onChange(parseFloat(sli.value));});
  if(opts.valId)valEl.id=opts.valId;
  row.append(lbl,sli,valEl);
  row._sli=sli;row._val=valEl;row._fill=fillSli;
  return row;
}

function mkEQBand(label,val){
  var band=document.createElement('div');band.className='rc-eq-band';
  var tw=document.createElement('div');tw.style.cssText='position:relative;height:110px;width:22px;display:flex;align-items:center;justify-content:center;';
  var track=document.createElement('div');track.className='rc-eq-track';
  var fTop=document.createElement('div');fTop.className='rc-eq-fill-top';
  var fBot=document.createElement('div');fBot.className='rc-eq-fill-bot';
  var thumb=document.createElement('div');thumb.className='rc-eq-thumb';
  var sli=document.createElement('input');
  sli.type='range';sli.className='rc-eq-sli';
  sli.min=-12;sli.max=12;sli.step=0.5;sli.value=val||0;
  function upd(){var v=parseFloat(sli.value);var pct=(v+12)/24*100;if(v>0){fTop.style.height=(pct-50)+'%';fTop.style.top=(100-pct)+'%';fTop.style.bottom='auto';fBot.style.height='0';}else{fBot.style.height=(50-pct)+'%';fBot.style.top=pct+'%';fBot.style.bottom='auto';fTop.style.height='0';}thumb.style.bottom='calc('+pct+'% - 3px)';}
  upd();
  sli.addEventListener('input',upd);
  var lbl2=document.createElement('div');lbl2.className='rc-eq-lbl';lbl2.textContent=label;
  track.append(fTop,fBot,thumb,sli);tw.appendChild(track);
  band.append(tw,lbl2);band._sli=sli;band._upd=upd;return band;
}

/* ─── PAGE BUILDERS ───────────────────────────────────────────── */

function buildMainPage(){
  var page=document.createElement('div');page.id='page-main';page.className='rc-page';

  /* Status card */
  var sc=document.createElement('div');sc.className='rc-status-card';
  var sl=document.createElement('div');sl.className='rc-status-left';
  var stitle=document.createElement('div');stitle.className='rc-status-title';stitle.textContent='Status';
  var micRow=document.createElement('div');micRow.className='rc-mic-status';
  var dot=document.createElement('span');dot.className='rc-mic-dot';dot.id='rc-micdot';
  var mictxt=document.createElement('span');mictxt.id='rc-mictext';mictxt.style.cssText='font-size:11px;font-weight:500;';mictxt.textContent='Waiting...';
  micRow.append(dot,mictxt);sl.append(stitle,micRow);
  var sr=document.createElement('div');sr.className='rc-status-right';
  var oll=document.createElement('div');oll.className='rc-level-label';oll.textContent='Output Level';
  var ledRow=document.createElement('div');ledRow.className='rc-led-row';
  for(var li=0;li<22;li++){var led=document.createElement('div');led.className='rc-led';led.id='led-'+li;ledRow.appendChild(led);}
  var ledPct=document.createElement('span');ledPct.className='rc-led-pct';ledPct.id='led-pct';ledPct.textContent='0%';ledRow.appendChild(ledPct);
  sr.append(oll,ledRow);
  var tog=mkToggle('rc-power',ST.on,function(v){ST.on=v;CHAIN.update();saveState();setStatus(v?'ACTIVE':'BYPASS',v?'#22c55e':'#f59e0b');});
  sc.append(sl,sr,tog.el);page.appendChild(sc);

  /* Stereo toggle — separate from the master power toggle. Turning
     this off does not touch StereoLoudMic's ON/OFF; it only affects
     whether we ask for a 2-channel mic and keep both channels through
     the graph (see getUserMedia override) vs the normal single-channel
     Discord path. Takes effect on the next call/mic (re)join. */
  var stereoCard=document.createElement('div');stereoCard.className='rc-status-card';stereoCard.style.marginTop='10px';
  var stL=document.createElement('div');stL.className='rc-status-left';
  var stTitle=document.createElement('div');stTitle.className='rc-status-title';stTitle.textContent='Stereo Mic';
  var stSub=document.createElement('div');stSub.style.cssText='font-size:11px;opacity:.65;margin-top:2px;';
  stSub.textContent='Real L/R input, no mono fallback tricks';
  stL.append(stTitle,stSub);
  var stTog=mkToggle('rc-stereo',ST.stereoOn,function(v){
    ST.stereoOn=v;saveState();
    stSub.textContent=v?'Real L/R input, no mono fallback tricks':'Single channel (rejoin the call to apply)';
  });
  stereoCard.append(stL,stTog.el);page.appendChild(stereoCard);

  /* Master Controls */
  var mc=document.createElement('div');mc.className='rc-card';
  var mch=document.createElement('div');mch.className='rc-card-head';
  var mct=document.createElement('div');mct.className='rc-card-title';mct.textContent='Master Controls';
  mch.appendChild(mct);mc.appendChild(mch);
  var vsWrap=document.createElement('div');vsWrap.className='rc-vsliders';
  var masterDefs=[
    {key:'preAmp',    label:'Pre Amp',     min:0,max:1,  step:0.01, value:ST.preAmp,    fmt:function(v){return Math.round(v*300+100)+'%';}},
    {key:'masterGain',label:'Gain',        min:0,max:20, step:0.1,  value:ST.masterGain,fmt:function(v){
      // Display-only: can read up into the hundreds of millions for that
      // "LOUD" feel. The value actually fed to the AudioParam is always
      // a separate, finite, hard-clamped number — see CHAIN.update().
      var disp=Math.pow(10,v*8/20);
      if(disp<1000)return disp.toFixed(1)+'×';
      if(disp<1e6)return Math.round(disp).toLocaleString()+'×';
      return (disp/1e6).toFixed(1)+'M×';
    }},
    {key:'distMix',   label:'Distortion',  min:0,max:1,  step:0.01, value:ST.distMix,   fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
    {key:'boost',     label:'Boost',       min:0,max:1,  step:0.01, value:ST.boost,     fmt:function(v){return Math.round(v*100)+'%';}},
    {key:'mix',       label:'Mix',         min:0,max:1,  step:0.01, value:ST.mix,       fmt:function(v){return Math.round(v*100)+'%';}},
  ];
  masterDefs.forEach(function(s){
    var w=mkVSlider({label:s.label,min:s.min,max:s.max,step:s.step,value:s.value,fmt:s.fmt,
      onChange:function(v){ST[s.key]=v;CHAIN.update();saveState();}});
    vsWrap.appendChild(w);
  });
  mc.appendChild(vsWrap);page.appendChild(mc);

  /* EQ card */
  var eqc=document.createElement('div');eqc.className='rc-card';
  var eqch=document.createElement('div');eqch.className='rc-card-head';
  var eqt=document.createElement('div');eqt.className='rc-card-title';eqt.textContent='Equalizer';
  var eqRight=document.createElement('div');eqRight.style.cssText='display:flex;gap:6px;align-items:center;';
  var eqSel=document.createElement('select');
  ['Custom','Flat','Vocal','Bass+','Bright','Smiley'].forEach(function(n){var o=document.createElement('option');o.value=n.toLowerCase().replace('+','p').replace(' ','');o.textContent=n;eqSel.appendChild(o);});
  var eqRst=document.createElement('div');eqRst.className='rc-icon-btn';eqRst.textContent='↺';eqRst.title='Reset to flat';
  eqRight.append(eqSel,eqRst);eqch.append(eqt,eqRight);eqc.appendChild(eqch);
  var EQP={custom:null,flat:[0,0,0,0,0,0,0,0,0,0],vocal:[-1,0,1,3,3,2,1,0,0,-1],bassp:[6,5,3,0,0,0,0,0,7,0],bright:[-2,-1,0,1,2,3,4,5,0,5],smiley:[4,3,1,-2,-3,-2,1,3,4,3]};
  var eqArea=document.createElement('div');eqArea.className='rc-eq-area';
  var eqYL=document.createElement('div');eqYL.className='rc-eq-labels';
  ['+12dB','0dB','-12dB'].forEach(function(l){var sp=document.createElement('div');sp.className='rc-eq-label';sp.textContent=l;eqYL.appendChild(sp);});
  var eqBands2=document.createElement('div');eqBands2.className='rc-eq-bands';
  var eqBandEls=[];
  ['60Hz','150Hz','400Hz','1kHz','2.4kHz','6kHz','12kHz','16kHz','Bass','Treble'].forEach(function(lbl,i){
    var b=mkEQBand(lbl,ST.eq[i]);
    (function(idx,band){band._sli.addEventListener('input',function(){ST.eq[idx]=parseFloat(band._sli.value);eqSel.value='custom';CHAIN.update();saveState();});})(i,b);
    eqBandEls.push(b);eqBands2.appendChild(b);
  });
  eqArea.append(eqYL,eqBands2);eqc.appendChild(eqArea);
  function applyEQP2(key){var g=EQP[key];if(!g)return;g.forEach(function(v,i){ST.eq[i]=v;eqBandEls[i]._sli.value=v;eqBandEls[i]._upd();});CHAIN.update();saveState();}
  eqSel.addEventListener('change',function(){applyEQP2(eqSel.value);});
  eqRst.addEventListener('click',function(){applyEQP2('flat');eqSel.value='flat';});

  /* EQ bottom bar — Presets + Mic Monitor */
  var eqBot=document.createElement('div');eqBot.className='rc-eq-bot';
  var preLbl=document.createElement('span');preLbl.style.cssText='font-size:10px;color:rgba(255,255,255,.35);';preLbl.textContent='Presets';
  var preSel=document.createElement('select');
  function rebuildPreSel(){preSel.innerHTML='<option value="">-- Load Preset --</option>';getPresets().forEach(function(p,i){var o=document.createElement('option');o.value=i;o.textContent=p.name;preSel.appendChild(o);});}
  rebuildPreSel();
  preSel.addEventListener('change',function(){var idx=parseInt(preSel.value);if(isNaN(idx))return;var ps=getPresets();if(ps[idx]){try{Object.assign(ST,JSON.parse(ps[idx].state));CHAIN.update();saveState();}catch(e){}}preSel.value='';});
  var saveBtn=document.createElement('div');saveBtn.className='rc-icon-btn';saveBtn.textContent='💾';saveBtn.title='Save preset';
  saveBtn.addEventListener('click',function(){var n=prompt('Preset name:');if(!n)return;var ps=getPresets();ps.push({name:n,state:JSON.stringify(ST)});setPresets(ps);rebuildPreSel();saveBtn.style.color='#22c55e';setTimeout(function(){saveBtn.style.color='';},800);});
  var delBtn=document.createElement('div');delBtn.className='rc-icon-btn';delBtn.textContent='🗑';delBtn.title='Clear EQ';
  delBtn.addEventListener('click',function(){applyEQP2('flat');eqSel.value='flat';});
  var cpyBtn=document.createElement('div');cpyBtn.className='rc-icon-btn';cpyBtn.textContent='📋';cpyBtn.title='Copy EQ values';
  cpyBtn.addEventListener('click',function(){var s='['+ST.eq.map(function(v){return v.toFixed(1);}).join(',')+']';try{navigator.clipboard.writeText(s);}catch(e){}cpyBtn.style.color='#a78bfa';setTimeout(function(){cpyBtn.style.color='';},700);});
  var sp2=document.createElement('span');sp2.style.flex='1';
  var monLbl=document.createElement('span');monLbl.style.cssText='font-size:10px;color:rgba(255,255,255,.38);';monLbl.textContent='Mic Monitor';
  var monSli=document.createElement('input');monSli.type='range';monSli.className='rc-mini-sli';
  monSli.min=0;monSli.max=1;monSli.step=0.01;monSli.value=ST.monVol||0.6;
  var monPct=document.createElement('span');monPct.className='rc-mini-val';monPct.textContent=Math.round(ST.monVol*100)+'%';
  function updMon(){var v=parseFloat(monSli.value);var p=(v*100).toFixed(1);monSli.style.background='linear-gradient(to right,#7c3aed '+p+'%,rgba(255,255,255,.09) '+p+'%)';monPct.textContent=Math.round(v*100)+'%';}
  updMon();
  monSli.addEventListener('input',function(){var v=parseFloat(monSli.value);ST.monVol=v;updMon();if(CHAIN.mon&&window.__RexxCtx)CHAIN.mon.gain.setTargetAtTime(ST.monOn?v:0,window.__RexxCtx.currentTime,0.05);saveState();});
  eqBot.append(preLbl,preSel,saveBtn,delBtn,cpyBtn,sp2,monLbl,monSli,monPct);
  eqc.appendChild(eqBot);page.appendChild(eqc);
  return page;
}

function buildLoudnessPage(){
  var page=document.createElement('div');page.id='page-loud';page.className='rc-page';
  var c1=document.createElement('div');c1.className='rc-card';
  var h1=document.createElement('div');h1.className='rc-card-head';
  var t1=document.createElement('div');t1.className='rc-card-title';t1.textContent='Amplifier';
  h1.appendChild(t1);c1.appendChild(h1);
  [
    {key:'preAmp',    label:'Pre Amp',     min:0,max:1,  fmt:function(v){return Math.round(v*300+100)+'%';}},
    {key:'masterGain',label:'Master Gain', min:0,max:20,step:0.1,fmt:function(v){var x=Math.pow(10,v*2/20)*2;return x<10?x.toFixed(1)+'×':Math.round(x)+'×';}},
    {key:'boost',     label:'Boost',       min:0,max:1,  fmt:function(v){return Math.round(v*100)+'%';}},
    {key:'mix',       label:'Wet/Dry Mix', min:0,max:1,  fmt:function(v){return Math.round(v*100)+'%';}},
  ].forEach(function(s){
    c1.appendChild(mkHSlider({label:s.label,min:s.min||0,max:s.max||1,step:s.step||0.01,value:ST[s.key],fmt:s.fmt,
      onChange:function(v){ST[s.key]=v;CHAIN.update();saveState();}}));
  });
  page.appendChild(c1);
  var c2=document.createElement('div');c2.className='rc-card';
  var h2=document.createElement('div');h2.className='rc-card-head';
  var t2=document.createElement('div');t2.className='rc-card-title';t2.textContent='Tone & Presence';
  h2.appendChild(t2);c2.appendChild(h2);
  [
    {key:'presence',label:'Presence',       fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
    {key:'clarity', label:'Clarity',        fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
    {key:'air',     label:'Air / Sparkle',  fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
    {key:'bass',    label:'Bass Boost',     fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
  ].forEach(function(s){
    c2.appendChild(mkHSlider({label:s.label,min:0,max:1,value:ST[s.key],fmt:s.fmt,
      onChange:function(v){ST[s.key]=v;CHAIN.update();saveState();}}));
  });
  page.appendChild(c2);
  var c3=document.createElement('div');c3.className='rc-card';
  var h3=document.createElement('div');h3.className='rc-card-head';
  var t3=document.createElement('div');t3.className='rc-card-title';t3.textContent='Dynamics';
  h3.appendChild(t3);c3.appendChild(h3);
  [
    {key:'gate',label:'Noise Gate', fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
    {key:'comp',label:'Compressor', fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
  ].forEach(function(s){
    c3.appendChild(mkHSlider({label:s.label,min:0,max:1,value:ST[s.key],fmt:s.fmt,
      onChange:function(v){ST[s.key]=v;CHAIN.update();saveState();}}));
  });
  page.appendChild(c3);
  return page;
}

function buildEqualizerPage(){
  var page=document.createElement('div');page.id='page-eq';page.className='rc-page';
  var c=document.createElement('div');c.className='rc-card';
  var h=document.createElement('div');h.className='rc-card-head';
  var t=document.createElement('div');t.className='rc-card-title';t.textContent='10-Band Equalizer';
  var rst=document.createElement('div');rst.className='rc-icon-btn';rst.textContent='↺';
  h.append(t,rst);c.appendChild(h);
  var eqArea=document.createElement('div');eqArea.className='rc-eq-area';
  var eqYL=document.createElement('div');eqYL.className='rc-eq-labels';
  ['+12dB','0dB','-12dB'].forEach(function(l){var sp=document.createElement('div');sp.className='rc-eq-label';sp.textContent=l;eqYL.appendChild(sp);});
  var eqBands3=document.createElement('div');eqBands3.className='rc-eq-bands';
  var eqBandEls2=[];
  ['60Hz','150Hz','400Hz','1kHz','2.4kHz','6kHz','12kHz','16kHz','Bass','Treble'].forEach(function(lbl,i){
    var b=mkEQBand(lbl,ST.eq[i]);
    (function(idx,band){band._sli.addEventListener('input',function(){ST.eq[idx]=parseFloat(band._sli.value);CHAIN.update();saveState();});})(i,b);
    eqBandEls2.push(b);eqBands3.appendChild(b);
  });
  eqArea.append(eqYL,eqBands3);c.appendChild(eqArea);
  rst.addEventListener('click',function(){eqBandEls2.forEach(function(b,i){ST.eq[i]=0;b._sli.value=0;b._upd();});CHAIN.update();saveState();});
  var qs=document.createElement('div');qs.style.cssText='display:flex;gap:5px;padding:6px 14px 10px;flex-wrap:wrap;';
  [['Flat',[0,0,0,0,0,0,0,0,0,0]],['Vocal',[-1,0,1,3,3,2,1,0,0,-1]],['Bass+',[6,5,3,0,0,0,0,0,7,0]],['Bright',[-2,-1,0,1,2,3,4,5,0,5]],['Smiley',[4,3,1,-2,-3,-2,1,3,4,3]],['V-Shape',[5,3,0,-3,-4,-3,0,3,5,4]]].forEach(function(pr){
    var btn=document.createElement('div');btn.className='rc-mbtn';btn.textContent=pr[0];
    btn.addEventListener('click',function(){pr[1].forEach(function(g,i){ST.eq[i]=g;eqBandEls2[i]._sli.value=g;eqBandEls2[i]._upd();});CHAIN.update();saveState();});
    qs.appendChild(btn);
  });
  c.appendChild(qs);page.appendChild(c);
  return page;
}

function buildVoicePage(){
  var page=document.createElement('div');page.id='page-voice';page.className='rc-page';
  var cats=['All','Natural','Male','Female','Anime','Robot','Radio','Dark','Fun','Space','Epic','Tools'];
  var catRow=document.createElement('div');catRow.className='rc-vc-cats';

  var boostCard=document.createElement('div');boostCard.className='rc-boost-card';
  var boostTitle=document.createElement('div');boostTitle.className='rc-boost-title';boostTitle.textContent='🔊 Mic Boost — Clean Sensitivity';
  var sensRow=mkHSlider({label:'Mic Sensitivity',min:0,max:3,step:0.01,value:ST.sensitivity,
    fmt:function(v){return Math.round(v*100)+'%';},
    onChange:function(v){ST.sensitivity=v;CHAIN.update();saveState();}});
  var boostHint=document.createElement('div');boostHint.className='rc-boost-hint';
  boostHint.textContent='Clean amplification only. 100%=original. 300%=3× louder pickup.';
  boostCard.append(boostTitle,sensRow,boostHint);

  var grid=document.createElement('div');grid.className='rc-vc-grid';
  function renderGrid(cat){
    grid.innerHTML='';
    var filtered=cat==='All'?VOICE_PROFILES:VOICE_PROFILES.filter(function(p){return p.cat===cat;});
    filtered.forEach(function(vp){
      var btn=document.createElement('div');btn.className='rc-vc-btn'+(ST.voiceProfile===vp.id?' active':'');
      btn.innerHTML='<span class="rc-vc-icon">'+vp.icon+'</span>'+vp.name;
      btn.addEventListener('click',function(){
        grid.querySelectorAll('.rc-vc-btn').forEach(function(b){b.classList.remove('active');});
        btn.classList.add('active');
        applyVoiceProfile(vp.id);
        boostCard.classList.toggle('show',!!vp.mb);
        if(vp.mb){sensRow._sli.value=ST.sensitivity;sensRow._fill();}
      });
      grid.appendChild(btn);
    });
  }
  cats.forEach(function(cat){
    var btn=document.createElement('div');btn.className='rc-cat-btn'+(cat==='All'?' active':'');
    btn.textContent=cat;
    btn.addEventListener('click',function(){
      catRow.querySelectorAll('.rc-cat-btn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');renderGrid(cat);
    });
    catRow.appendChild(btn);
  });
  renderGrid('All');
  if(ST.micBoostOn)boostCard.classList.add('show');

  var pitchCard=document.createElement('div');pitchCard.className='rc-card';
  var ph=document.createElement('div');ph.className='rc-card-head';
  var pt=document.createElement('div');pt.className='rc-card-title';pt.textContent='Manual Pitch';
  ph.appendChild(pt);pitchCard.appendChild(ph);
  pitchCard.appendChild(mkHSlider({label:'Pitch Shift',min:-12,max:12,step:0.5,value:ST.pitch,
    fmt:function(v){return (v>0?'+':'')+v.toFixed(1)+' st';},
    onChange:function(v){ST.pitch=v;CHAIN.update();saveState();}}));
  page.append(catRow,boostCard,grid,pitchCard);
  return page;
}

function buildEffectsPage(){
  var page=document.createElement('div');page.id='page-effects';page.className='rc-page';

  /* Distortion */
  var c=document.createElement('div');c.className='rc-card';
  var h=document.createElement('div');h.className='rc-card-head';
  var t=document.createElement('div');t.className='rc-card-title';t.textContent='Distortion';
  h.appendChild(t);c.appendChild(h);
  var mg=document.createElement('div');mg.className='rc-mode-row';
  ['Soft Sat','Tube','Crunch','Fuzz','Radio','Hard Clip'].forEach(function(m,i){
    var btn=document.createElement('div');btn.className='rc-mbtn'+(ST.distMode===i?' active':'');
    btn.textContent=m;
    btn.addEventListener('click',function(){ST.distMode=i;mg.querySelectorAll('.rc-mbtn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');CHAIN.update();saveState();});
    mg.appendChild(btn);
  });
  c.appendChild(mg);
  [{key:'distDrive',label:'Drive',  min:0,max:1,fmt:function(v){return Math.round(v*100)+'%';}},
   {key:'distTone', label:'Tone',   min:0,max:1,fmt:function(v){return Math.round(v*100)+'%';}},
   {key:'distMix',  label:'Mix',    min:0,max:1,fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
   {key:'distOut',  label:'Output', min:0,max:2,fmt:function(v){return Math.round(v*100)+'%';}},
  ].forEach(function(s){
    c.appendChild(mkHSlider({label:s.label,min:s.min||0,max:s.max||1,value:ST[s.key],fmt:s.fmt,
      onChange:function(v){ST[s.key]=v;CHAIN.update();saveState();}}));
  });
  page.appendChild(c);

  /* Echo */
  var c2=document.createElement('div');c2.className='rc-card';
  var h2=document.createElement('div');h2.className='rc-card-head';
  var t2=document.createElement('div');t2.className='rc-card-title';t2.textContent='Echo / Delay';
  h2.appendChild(t2);c2.appendChild(h2);
  [{key:'echoWet', label:'Echo Wet', min:0,max:1,   fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
   {key:'echoTime',label:'Echo Time',min:0.01,max:1,fmt:function(v){return Math.round(v*1000)+'ms';}},
   {key:'echoFb',  label:'Feedback', min:0,max:0.9,  fmt:function(v){return Math.round(v*100)+'%';}},
  ].forEach(function(s){
    c2.appendChild(mkHSlider({label:s.label,min:s.min||0,max:s.max||1,value:ST[s.key],fmt:s.fmt,
      onChange:function(v){ST[s.key]=v;CHAIN.update();saveState();}}));
  });
  page.appendChild(c2);

  /* Wider */
  var c3=document.createElement('div');c3.className='rc-card';
  var h3=document.createElement('div');h3.className='rc-card-head';
  var t3=document.createElement('div');t3.className='rc-card-title';t3.textContent='Stereo Wider';
  h3.appendChild(t3);c3.appendChild(h3);
  var wModes2=['Soft','Wide','Ultra','Extreme'];
  var mg3=document.createElement('div');mg3.className='rc-mode-row';
  wModes2.forEach(function(m,i){
    var btn=document.createElement('div');btn.className='rc-mbtn'+(ST.widerMode===i?' active':'');
    btn.textContent=m;
    btn.addEventListener('click',function(){ST.widerMode=i;mg3.querySelectorAll('.rc-mbtn').forEach(function(b){b.classList.remove('active');});btn.classList.add('active');CHAIN.update();saveState();});
    mg3.appendChild(btn);
  });
  c3.appendChild(mg3);
  [{key:'widerWidth', label:'Width',        min:0,max:2,  fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
   {key:'widerDepth', label:'Delay Depth',  min:0,max:1,  fmt:function(v){return Math.round(v*100)+'%';}},
   {key:'widerStereo',label:'Stereo Amount',min:0,max:1,  fmt:function(v){return Math.round(v*100)+'%';}},
  ].forEach(function(s){
    c3.appendChild(mkHSlider({label:s.label,min:s.min||0,max:s.max||2,step:0.01,value:ST[s.key],fmt:s.fmt,
      onChange:function(v){ST[s.key]=v;CHAIN.update();saveState();}}));
  });
  page.appendChild(c3);
  return page;
}

function buildReverbPage(){
  var page=document.createElement('div');page.id='page-reverb';page.className='rc-page';
  var c=document.createElement('div');c.className='rc-card';
  var h=document.createElement('div');h.className='rc-card-head';
  var t=document.createElement('div');t.className='rc-card-title';t.textContent='Reverb';
  h.appendChild(t);c.appendChild(h);
  var rp=document.createElement('div');rp.className='rc-rp-row';
  var revPresets=[
    {name:'Room',     wet:0.25,decay:1.5, room:1,  pre:0.005,damp:0.65},
    {name:'Hall',     wet:0.40,decay:3.5, room:1.5,pre:0.015,damp:0.45},
    {name:'Plate',    wet:0.38,decay:2.5, room:1.2,pre:0.008,damp:0.5},
    {name:'Cathedral',wet:0.55,decay:7,   room:2.5,pre:0.025,damp:0.3},
    {name:'Cave',     wet:0.60,decay:5,   room:2,  pre:0.02, damp:0.2},
    {name:'Space',    wet:0.70,decay:9,   room:3,  pre:0.04, damp:0.12},
  ];
  var revSliders={};
  revPresets.forEach(function(pr){
    var btn=document.createElement('div');btn.className='rc-rpbtn';btn.textContent=pr.name;
    btn.addEventListener('click',function(){
      ST.reverbWet=pr.wet;ST.reverbDecay=pr.decay;ST.reverbRoom=pr.room;ST.reverbPre=pr.pre;ST.reverbDamp=pr.damp;
      rp.querySelectorAll('.rc-rpbtn').forEach(function(b){b.classList.remove('active');});
      btn.classList.add('active');CHAIN.update();saveState();
      Object.keys(revSliders).forEach(function(k){if(ST[k]!==undefined){revSliders[k]._sli.value=ST[k];revSliders[k]._fill();}});
    });
    rp.appendChild(btn);
  });
  c.appendChild(rp);
  [{key:'reverbWet',  label:'Wet',       min:0,  max:1,  step:0.01, fmt:function(v){return v<0.01?'OFF':Math.round(v*100)+'%';}},
   {key:'reverbDecay',label:'Decay',     min:0.1,max:10, step:0.1,  fmt:function(v){return v.toFixed(1)+'s';}},
   {key:'reverbRoom', label:'Room Size', min:0.1,max:4,  step:0.05, fmt:function(v){return v.toFixed(2)+'×';}},
   {key:'reverbPre',  label:'Pre-Delay', min:0,  max:0.1,step:0.001,fmt:function(v){return Math.round(v*1000)+'ms';}},
   {key:'reverbDamp', label:'Damping',   min:0,  max:1,  step:0.01, fmt:function(v){return Math.round(v*100)+'%';}},
  ].forEach(function(s){
    var row=mkHSlider({label:s.label,min:s.min,max:s.max,step:s.step,value:ST[s.key],fmt:s.fmt,
      onChange:function(v){ST[s.key]=v;CHAIN.update();saveState();}});
    revSliders[s.key]=row;c.appendChild(row);
  });
  page.appendChild(c);
  return page;
}

function buildMP3Page(){
  var page=document.createElement('div');page.id='page-mp3';page.className='rc-page';
  var mp3State={buf:null,playing:false};
  var c=document.createElement('div');c.className='rc-card';
  var h=document.createElement('div');h.className='rc-card-head';
  var t=document.createElement('div');t.className='rc-card-title';t.textContent='MP3 / Audio Player';
  h.appendChild(t);c.appendChild(h);
  var zone=document.createElement('div');zone.className='rc-upload-zone';
  zone.innerHTML='<div class="rc-mp3-icon">🎵</div>Click to upload audio file<br><span style="font-size:9px;opacity:.6;">MP3 · WAV · OGG · FLAC · M4A</span>';
  var finp=document.createElement('input');finp.type='file';finp.accept='audio/*';finp.style.display='none';
  zone.addEventListener('click',function(){finp.click();});
  var info=document.createElement('div');info.style.cssText='padding:6px 14px;font-size:11px;color:rgba(255,255,255,.5);display:none;';
  var ctrlRow=document.createElement('div');ctrlRow.style.cssText='display:flex;gap:8px;padding:0 14px 12px;align-items:center;';
  var playBtn=document.createElement('div');playBtn.className='rc-pbtn';playBtn.style.cssText='padding:7px 16px;font-size:11px;';playBtn.textContent='▶ Play';
  var stopBtn=document.createElement('div');stopBtn.className='rc-pbtn';stopBtn.style.cssText='padding:7px 14px;font-size:11px;background:rgba(255,255,255,.04);border-color:rgba(255,255,255,.1);color:rgba(255,255,255,.45);';stopBtn.textContent='■ Stop';
  finp.addEventListener('change',function(){
    var f=finp.files[0];if(!f)return;
    var rd=new FileReader();
    rd.onload=function(e){
      var ctx=window.__RexxCtx;if(!ctx)ctx=new (window.AudioContext||window.webkitAudioContext)({sampleRate:48000});
      ctx.decodeAudioData(e.target.result.slice(0),function(buf){
        mp3State.buf=buf;info.textContent='🎵 '+f.name+' — '+buf.duration.toFixed(1)+'s';
        info.style.display='block';zone.style.display='none';
      },function(){info.textContent='⚠ Could not decode audio';info.style.display='block';});
    };
    rd.readAsArrayBuffer(f);
  });
  playBtn.addEventListener('click',function(){
    if(!mp3State.buf||!window.__RexxCtx)return;
    if(mp3State.playing){try{CHAIN.mp3Src&&CHAIN.mp3Src.stop();}catch(e){}CHAIN.mp3Src=null;mp3State.playing=false;playBtn.textContent='▶ Play';return;}
    CHAIN.connectMP3(window.__RexxCtx,mp3State.buf);mp3State.playing=true;playBtn.textContent='⏸ Pause';
  });
  stopBtn.addEventListener('click',function(){try{CHAIN.mp3Src&&CHAIN.mp3Src.stop();}catch(e){}CHAIN.mp3Src=null;mp3State.playing=false;playBtn.textContent='▶ Play';});
  ctrlRow.append(playBtn,stopBtn);
  c.append(zone,finp,info,ctrlRow);page.appendChild(c);
  var c2=document.createElement('div');c2.className='rc-card';
  var h2=document.createElement('div');h2.className='rc-card-head';
  var t2=document.createElement('div');t2.className='rc-card-title';t2.textContent='Mix';
  h2.appendChild(t2);c2.appendChild(h2);
  c2.appendChild(mkHSlider({label:'Volume',min:0,max:1,value:ST.mp3Vol,
    fmt:function(v){return Math.round(v*100)+'%';},onChange:function(v){CHAIN.setMP3Vol(v);}}));
  c2.appendChild(mkHSlider({label:'DSP Mix',min:0,max:1,value:ST.mp3MicMix,
    fmt:function(v){return Math.round(v*100)+'%';},onChange:function(v){CHAIN.setMP3Mix(v);}}));
  var mixHint=document.createElement('div');mixHint.style.cssText='font-size:9px;color:rgba(255,255,255,.25);padding:0 14px 10px;';
  mixHint.textContent='DSP Mix: how much audio passes through EQ, reverb, voice FX etc.';
  c2.appendChild(mixHint);
  page.appendChild(c2);
  return page;
}

function buildSettingsPage(){
  var page=document.createElement('div');page.id='page-settings';page.className='rc-page';

  /* Microphone select */
  var c=document.createElement('div');c.className='rc-card';
  var h=document.createElement('div');h.className='rc-card-head';
  var t=document.createElement('div');t.className='rc-card-title';t.textContent='Microphone';
  h.appendChild(t);c.appendChild(h);
  var dr=document.createElement('div');dr.style.cssText='padding:8px 14px;';
  var sel=document.createElement('select');sel.style.cssText='width:100%;padding:6px 10px;border-radius:7px;font-size:11px;color:#e2e8f0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);outline:none;cursor:pointer;';
  sel.innerHTML='<option value="">Default Microphone</option>';
  if(navigator.mediaDevices.enumerateDevices){
    navigator.mediaDevices.enumerateDevices().then(function(devs){
      devs.filter(function(d){return d.kind==='audioinput';}).forEach(function(d,i){
        var o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||('Mic '+(i+1));sel.appendChild(o);
      });
    }).catch(function(){});
  }
  dr.appendChild(sel);c.appendChild(dr);page.appendChild(c);

  /* Mic Monitor */
  var c2=document.createElement('div');c2.className='rc-card';
  var h2=document.createElement('div');h2.className='rc-card-head';
  var t2=document.createElement('div');t2.className='rc-card-title';t2.textContent='Mic Monitor';
  h2.appendChild(t2);c2.appendChild(h2);
  var mr=document.createElement('div');mr.style.cssText='display:flex;align-items:center;gap:12px;padding:8px 14px;';
  var ml=document.createElement('span');ml.style.cssText='font-size:11px;color:rgba(255,255,255,.5);flex:1;';ml.textContent='Hear yourself through headphones';
  var mt=mkToggle('rc-mon',ST.monOn,function(v){CHAIN.setMon(v);saveState();});
  mr.append(ml,mt.el);c2.appendChild(mr);
  c2.appendChild(mkHSlider({label:'Monitor Vol',min:0,max:1,value:ST.monVol,
    fmt:function(v){return Math.round(v*100)+'%';},
    onChange:function(v){ST.monVol=v;if(CHAIN.mon&&window.__RexxCtx)CHAIN.mon.gain.setTargetAtTime(ST.monOn?v:0,window.__RexxCtx.currentTime,0.05);saveState();}}));
  page.appendChild(c2);

  /* Presets */
  var c3=document.createElement('div');c3.className='rc-card';
  var h3=document.createElement('div');h3.className='rc-card-head';
  var t3=document.createElement('div');t3.className='rc-card-title';t3.textContent='Saved Presets';
  h3.appendChild(t3);c3.appendChild(h3);
  var plist=document.createElement('div');c3.appendChild(plist);
  var pRow=document.createElement('div');pRow.style.cssText='display:flex;gap:7px;padding:8px 14px;';
  var pni=document.createElement('input');pni.type='text';pni.placeholder='Preset name…';
  pni.style.cssText='flex:1;padding:5px 9px;border-radius:7px;font-size:11px;color:#e2e8f0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);outline:none;';
  var psb=document.createElement('div');psb.className='rc-pbtn';psb.textContent='Save Current';
  function renderPresets2(){
    plist.innerHTML='';var ps=getPresets();
    if(!ps.length){plist.innerHTML='<div style="padding:10px 14px;font-size:11px;color:rgba(255,255,255,.25);">No presets yet. Adjust settings and click Save.</div>';return;}
    ps.forEach(function(p,idx){
      var item=document.createElement('div');item.className='rc-preset-item';
      var nm=document.createElement('div');nm.className='rc-preset-name';nm.textContent=p.name;
      var ld=document.createElement('div');ld.className='rc-pbtn';ld.textContent='Load';
      ld.addEventListener('click',function(){try{Object.assign(ST,JSON.parse(p.state));CHAIN.update();saveState();nm.style.color='#a78bfa';setTimeout(function(){nm.style.color='';},1200);}catch(e){}});
      var dl=document.createElement('div');dl.className='rc-pbtn del';dl.textContent='✕';
      dl.addEventListener('click',function(){var ps2=getPresets();ps2.splice(idx,1);setPresets(ps2);renderPresets2();});
      item.append(nm,ld,dl);plist.appendChild(item);
    });
  }
  psb.addEventListener('click',function(){var n=(pni.value||'').trim()||('Preset '+(Date.now()%10000));var ps=getPresets();ps.push({name:n,state:JSON.stringify(ST)});setPresets(ps);pni.value='';renderPresets2();});
  pRow.append(pni,psb);c3.appendChild(pRow);renderPresets2();page.appendChild(c3);

  /* Reset */
  var c4=document.createElement('div');c4.className='rc-card';
  var h4=document.createElement('div');h4.className='rc-card-head';
  var t4=document.createElement('div');t4.className='rc-card-title';t4.textContent='Reset';
  h4.appendChild(t4);c4.appendChild(h4);
  var rb=document.createElement('div');rb.className='rc-pbtn del';
  rb.style.cssText='margin:10px 14px;padding:8px 16px;font-size:11px;display:inline-block;cursor:pointer;';
  rb.textContent='Reset All Settings to Default';
  rb.addEventListener('click',function(){if(!confirm('Reset all StereoLoudMic settings to defaults?'))return;localStorage.removeItem(SK);location.reload();});
  c4.appendChild(rb);page.appendChild(c4);
  return page;
}

function buildGainRackPage(){
  var page=document.createElement('div');page.id='page-gainrack';page.className='rc-page';

  /* Header card */
  var hcard=document.createElement('div');hcard.className='rc-card';
  var hh=document.createElement('div');hh.className='rc-card-head';
  var ht=document.createElement('div');ht.className='rc-card-title';ht.textContent='Gain Rack — 5 Stage Chain';
  var hrst=document.createElement('div');hrst.className='rc-icon-btn';hrst.title='Reset all stages to 0 dB';hrst.textContent='↺';
  hh.append(ht,hrst);hcard.appendChild(hh);

  /* Signal flow hint */
  var flowHint=document.createElement('div');
  flowHint.style.cssText='font-size:9px;color:rgba(255,255,255,.25);padding:2px 14px 10px;letter-spacing:.3px;';
  flowHint.textContent='Mic → Pre Amp → EQ → FX → Stage 1 → Stage 2 → Stage 3 → Stage 4 → Stage 5 → Master → Output';
  hcard.appendChild(flowHint);

  /* Five gain stage columns */
  var grWrap=document.createElement('div');grWrap.className='rc-gr-wrap';
  var stageEls=[];

  function mkGainStage(idx){
    var col=document.createElement('div');col.className='rc-gs-col';

    /* Header row: toggle */
    var hdr=document.createElement('div');hdr.className='rc-gs-header';
    var tog=mkToggle(null,ST.gainStageOn[idx],function(v){
      ST.gainStageOn[idx]=v;
      CHAIN.update();saveState();
      track.style.opacity=v?'1':'0.3';
      col.classList.toggle('rc-gs-dis',!v);
    });
    tog.el.title='Enable/Disable Stage '+(idx+1);
    hdr.appendChild(tog.el);

    /* Vertical slider */
    var tw=document.createElement('div');tw.className='rc-gs-track-wrap';
    var track=document.createElement('div');track.className='rc-gs-track';
    var fTop=document.createElement('div');fTop.className='rc-gs-fill-top';
    var fBot=document.createElement('div');fBot.className='rc-gs-fill-bot';
    var zero=document.createElement('div');zero.className='rc-gs-zero';
    var thumb=document.createElement('div');thumb.className='rc-gs-thumb';
    var sli=document.createElement('input');
    sli.type='range';sli.className='rc-gs-inp';
    sli.min=-12;sli.max=24;sli.step=0.5;sli.value=ST.gainStages[idx];

    function updTrack(){
      var v=parseFloat(sli.value);
      var pct=(v+12)/36*100;
      var halfPct=(0+12)/36*100;
      if(v>=0){
        fTop.style.height=(pct-halfPct).toFixed(1)+'%';
        fTop.style.bottom=halfPct.toFixed(1)+'%';
        fBot.style.height='0';
      } else {
        fBot.style.height=(halfPct-pct).toFixed(1)+'%';
        fBot.style.top=pct.toFixed(1)+'%';
        fTop.style.height='0';
      }
      thumb.style.bottom='calc('+pct.toFixed(1)+'% - 4px)';
    }
    updTrack();

    var valBox=document.createElement('div');valBox.className='rc-gs-val';
    function fmtDB(v){return (v>0?'+':'')+v.toFixed(1)+' dB';}
    valBox.textContent=fmtDB(ST.gainStages[idx]);

    sli.addEventListener('input',function(){
      var v=parseFloat(sli.value);
      ST.gainStages[idx]=v;
      updTrack();
      valBox.textContent=fmtDB(v);
      CHAIN.update();saveState();
    });

    track.append(fTop,fBot,zero,thumb,sli);
    tw.appendChild(track);

    /* Reset button */
    var rst=document.createElement('div');rst.className='rc-gs-rst';rst.textContent='0 dB';
    rst.title='Reset to 0 dB (unity)';
    rst.addEventListener('click',function(){
      ST.gainStages[idx]=0;sli.value=0;updTrack();valBox.textContent=fmtDB(0);
      CHAIN.update();saveState();
    });

    /* Stage label */
    var num=document.createElement('div');num.className='rc-gs-num';num.textContent='Stage '+(idx+1);

    if(!ST.gainStageOn[idx])col.classList.add('rc-gs-dis');

    col.append(hdr,tw,valBox,rst,num);
    stageEls.push({sli:sli,val:valBox,upd:updTrack,tog:tog});
    return col;
  }

  for(var si=0;si<5;si++) grWrap.appendChild(mkGainStage(si));
  hcard.appendChild(grWrap);

  hrst.addEventListener('click',function(){
    for(var ri=0;ri<5;ri++){
      ST.gainStages[ri]=0;
      stageEls[ri].sli.value=0;
      stageEls[ri].upd();
      stageEls[ri].val.textContent='+0.0 dB';
    }
    CHAIN.update();saveState();
  });

  page.appendChild(hcard);

  /* Master Gain card */
  var mc=document.createElement('div');mc.className='rc-card';
  var mh=document.createElement('div');mh.className='rc-card-head';
  var mt2=document.createElement('div');mt2.className='rc-card-title';mt2.textContent='Master Gain';
  mh.appendChild(mt2);mc.appendChild(mh);
  mc.appendChild(mkHSlider({label:'Master Gain',min:0,max:20,step:0.1,value:ST.masterGain,
    fmt:function(v){var x=Math.pow(10,v*2/20)*2;return x<10?x.toFixed(1)+'×':Math.round(x)+'×';},
    onChange:function(v){ST.masterGain=v;CHAIN.update();saveState();}}));
  mc.appendChild(mkHSlider({label:'Boost',min:0,max:1,step:0.01,value:ST.boost,
    fmt:function(v){return Math.round(v*100)+'%';},
    onChange:function(v){ST.boost=v;CHAIN.update();saveState();}}));
  page.appendChild(mc);

  /* Output Level + Peak Meter */
  var meterCard=document.createElement('div');meterCard.className='rc-gr-meter';
  var meterTitle=document.createElement('div');meterTitle.className='rc-gr-meter-title';
  var mtl=document.createElement('span');mtl.textContent='Output Level + Peak Meter';
  var peakVal=document.createElement('span');peakVal.className='rc-gr-peak-val';peakVal.id='gr-peak-val';peakVal.textContent='-∞ dBFS';
  meterTitle.append(mtl,peakVal);
  meterCard.appendChild(meterTitle);

  var barWrap=document.createElement('div');barWrap.className='rc-gr-bar-wrap';
  var barLbl=document.createElement('div');barLbl.className='rc-gr-bar-lbl';barLbl.textContent='dBFS';

  var ledCol=document.createElement('div');ledCol.className='rc-gr-led-col';
  var grLeds=[];
  var grLedCount=24;
  for(var li=0;li<grLedCount;li++){
    var led=document.createElement('div');led.className='rc-gr-led';
    ledCol.appendChild(led);grLeds.push(led);
  }

  var peakBar=document.createElement('div');peakBar.className='rc-gr-peak-bar';
  var peakLeds=[];
  for(var pi=0;pi<grLedCount;pi++){
    var pled=document.createElement('div');pled.className='rc-gr-peak-led';
    peakBar.appendChild(pled);peakLeds.push(pled);
  }

  barWrap.append(barLbl,ledCol,peakBar);
  meterCard.appendChild(barWrap);

  var grStats=document.createElement('div');grStats.className='rc-gr-stats';
  var rmsEl=document.createElement('div');rmsEl.className='rc-gr-stat';rmsEl.innerHTML='RMS: <span id="gr-rms">-∞</span>';
  var pkHoldEl=document.createElement('div');pkHoldEl.className='rc-gr-stat';pkHoldEl.innerHTML='Peak Hold: <span id="gr-pkhold">-∞</span>';
  var stagesActiveEl=document.createElement('div');stagesActiveEl.className='rc-gr-stat';
  function updStagesActive(){var n=ST.gainStageOn.filter(function(x){return x;}).length;stagesActiveEl.innerHTML='Active Stages: <span>'+n+'/5</span>';}
  updStagesActive();
  grStats.append(rmsEl,pkHoldEl,stagesActiveEl);
  meterCard.appendChild(grStats);
  page.appendChild(meterCard);

  /* Meter animation */
  var grPeakHold=0,grPeakTimer=0,grRafId=null;
  var grBuf=new Uint8Array(1024);
  function animGRMeter(){
    grRafId=requestAnimationFrame(animGRMeter);
    if(!CHAIN.an)return;
    CHAIN.an.getByteTimeDomainData(grBuf);
    var pk=0,rmsSum=0;
    for(var i=0;i<grBuf.length;i++){
      var v=Math.abs((grBuf[i]-128)/128);
      if(v>pk)pk=v;
      rmsSum+=v*v;
    }
    var rms=Math.sqrt(rmsSum/grBuf.length);
    var pkDB=pk>0.0001?20*Math.log10(pk):-Infinity;
    var rmsDB=rms>0.0001?20*Math.log10(rms):-Infinity;
    if(pk>grPeakHold){grPeakHold=pk;grPeakTimer=60;}
    else{grPeakTimer--;if(grPeakTimer<0)grPeakHold*=0.98;}

    /* LED bar — map -48 to 0 dBFS across 24 LEDs */
    var litCount=Math.round(Math.max(0,Math.min(1,(pkDB+48)/48))*grLedCount);
    for(var li2=0;li2<grLedCount;li2++){
      var gld=grLeds[li2];
      if(li2<litCount){
        gld.className=li2<16?'rc-gr-led g':(li2<21?'rc-gr-led y':'rc-gr-led r');
      } else {
        gld.className='rc-gr-led';
      }
    }

    /* Peak hold LED */
    var peakLit=Math.round(Math.max(0,Math.min(1,(20*Math.log10(Math.max(grPeakHold,0.0001))+48)/48))*(grLedCount-1));
    for(var pi2=0;pi2<grLedCount;pi2++){peakLeds[pi2].className=pi2===peakLit&&grPeakHold>0.0001?'rc-gr-peak-led p':'rc-gr-peak-led';}

    /* Text */
    var pv=document.getElementById('gr-peak-val');if(pv)pv.textContent=isFinite(pkDB)?pkDB.toFixed(1)+' dBFS':'-∞ dBFS';
    var rv=document.getElementById('gr-rms');if(rv)rv.textContent=isFinite(rmsDB)?rmsDB.toFixed(1)+' dB':'-∞';
    var phv=document.getElementById('gr-pkhold');if(phv)phv.textContent=isFinite(20*Math.log10(Math.max(grPeakHold,0.0001)))?(20*Math.log10(grPeakHold)).toFixed(1)+' dB':'-∞';
  }

  page._onShow=function(){if(!grRafId)grRafId=requestAnimationFrame(animGRMeter);};
  page._onHide=function(){if(grRafId){cancelAnimationFrame(grRafId);grRafId=null;}};

  return page;
}

/* ─── MAIN UI ──────────────────────────────────────────────────── */
function buildUI(){
  var style=document.createElement('style');style.textContent=CSS;
  (document.head||document.documentElement).appendChild(style);

  /* FAB */
  var fab=document.createElement('div');fab.id='rc-fab';
  fab.title='StereoLoudMic';
  fab.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><line x1="4" y1="17" x2="4" y2="19"/><line x1="7" y1="13" x2="7" y2="19"/><line x1="10" y1="9" x2="10" y2="19"/><line x1="13" y1="6" x2="13" y2="19"/><line x1="16" y1="11" x2="16" y2="19"/><line x1="19" y1="15" x2="19" y2="19"/></svg>';
  document.body.appendChild(fab);

  /* Anchor the FAB next to Discord's own mic/mute button while in a
     call, instead of always sitting in a fixed corner. Falls back to
     the default bottom-right position (set in CSS) when not in a call
     or the button can't be found, so the panel is always reachable.
     Discord's own DOM class names are hashed/unstable, so we key off
     the accessibility label, which Discord keeps stable. */
  function findDiscordMicButton(){
    var candidates=document.querySelectorAll('[aria-label]');
    for(var i=0;i<candidates.length;i++){
      var label=(candidates[i].getAttribute('aria-label')||'').toLowerCase();
      if(label==='mute'||label==='unmute'){
        return candidates[i];
      }
    }
    return null;
  }
  function resetFabToCorner(){
    fab.classList.remove('rc-fab-anchored');
    fab.style.left='auto';fab.style.top='auto';
    fab.style.right='24px';fab.style.bottom='24px';
  }
  function positionFab(){
    var micBtn=findDiscordMicButton();
    if(!micBtn||!micBtn.isConnected){resetFabToCorner();return;}
    var r=micBtn.getBoundingClientRect();
    if(r.width===0&&r.height===0){resetFabToCorner();return;}
    fab.classList.add('rc-fab-anchored');
    // Sit just above-right of the mic button rather than on top of it,
    // so Discord's own VC controls stay fully clickable.
    fab.style.right='auto';fab.style.bottom='auto';
    var left=Math.min(window.innerWidth-52,Math.round(r.right+8));
    var top=Math.min(window.innerHeight-52,Math.max(4,Math.round(r.top-4)));
    fab.style.left=left+'px';
    fab.style.top=top+'px';
  }
  positionFab();
  new MutationObserver(positionFab).observe(document.body,{childList:true,subtree:true});
  window.addEventListener('resize',positionFab);
  setInterval(positionFab,1000); // cheap safety net if the observer ever misses a re-render

  /* Circular VU visualizer */
  var viz=document.createElement('div');viz.id='rc-viz';
  viz.innerHTML='<svg viewBox="0 0 32 32" fill="none"><rect class="rc-viz-bar" x="3" y="12" width="3" height="14" rx="1.5" fill="#8b5cf6"/><rect class="rc-viz-bar" x="7.5" y="8" width="3" height="18" rx="1.5" fill="#a78bfa"/><rect class="rc-viz-bar" x="12" y="5" width="3" height="21" rx="1.5" fill="#c4b5fd"/><rect class="rc-viz-bar" x="16.5" y="9" width="3" height="17" rx="1.5" fill="#a78bfa"/><rect class="rc-viz-bar" x="21" y="13" width="3" height="13" rx="1.5" fill="#8b5cf6"/></svg>';
  document.body.appendChild(viz);

  /* Panel */
  var panel=document.createElement('div');panel.id='rc';panel.style.display='none';

  /* Title bar */
  var titleBar=document.createElement('div');titleBar.className='rc-title';
  var logo=document.createElement('div');logo.className='rc-logo';
  logo.innerHTML='<svg class="rc-logo-icon" viewBox="0 0 22 22" fill="none"><rect x="1" y="14" width="3" height="6" rx="1.5" fill="#8b5cf6"/><rect x="5.5" y="10" width="3" height="10" rx="1.5" fill="#a78bfa"/><rect x="10" y="6" width="3" height="14" rx="1.5" fill="#c4b5fd"/><rect x="14.5" y="9" width="3" height="11" rx="1.5" fill="#a78bfa"/><rect x="19" y="12" width="3" height="8" rx="1.5" fill="#8b5cf6"/></svg>Stereo<em>LoudMic</em>';
  var spacer=document.createElement('div');spacer.className='rc-spacer';
  var statusBadge=document.createElement('span');statusBadge.id='rc-status';statusBadge.className='rc-status-badge';statusBadge.textContent='WAITING';
  function mkWBtn(txt,cls){var b=document.createElement('div');b.className='rc-wbtn'+(cls?' '+cls:'');b.textContent=txt;return b;}
  var minBtn=mkWBtn('−');var maxBtn=mkWBtn('□');var closeBtn=mkWBtn('✕','cls');
  titleBar.append(logo,spacer,statusBadge,minBtn,maxBtn,closeBtn);

  /* Body */
  var body=document.createElement('div');body.className='rc-body';
  var sidebar=document.createElement('div');sidebar.className='rc-sidebar';
  var content=document.createElement('div');content.className='rc-content';

  var navDef=[
    {id:'main',     label:'Main',      svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>'},
    {id:'loud',     label:'Loudness',  svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>'},
    {id:'eq',       label:'Equalizer', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 18H5V6h2v12zm4-6H9V6h2v6zm0 6H9v-4h2v4zm4-2h-2V6h2v10zm0 2h-2v-1h2v1zm4-10h-2V6h2v8zm0 6h-2v-4h2v4z"/></svg>'},
    {id:'voice',    label:'Voice',     svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 15 6.7 12H5c0 3.42 2.72 6.23 6 6.72V22h2v-3.28c3.28-.49 6-3.3 6-6.72h-1.7z"/></svg>'},
    {id:'effects',  label:'Effects',   svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 21h2v-2H7v2zm0-8h2v-2H7v2zm4 0h2v-2h-2v2zm0 8h2v-2h-2v2zm-8-4h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2v-2H3v2zm0-4h2V7H3v2zm8 4h2v-2h-2v2zm8-10v14c0 1.1-.9 2-2 2H9V3h10c1.1 0 2 .9 2 2z"/></svg>'},
    {id:'reverb',   label:'Reverb',    svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 19h18v2H3v-2zm0-4h18v2H3v-2zm5-5c0 1.66 1.34 3 3 3s3-1.34 3-3V4c0-1.66-1.34-3-3-3S8 2.34 8 6v4z"/></svg>'},
    {id:'mp3',      label:'MP3',       svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>'},
    {id:'settings', label:'Settings',  svg:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>'},
    {id:'gainrack', label:'Gain Rack', svg:'<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="4" width="3" height="16" rx="1.5"/><rect x="7.5" y="7" width="3" height="13" rx="1.5"/><rect x="12" y="2" width="3" height="18" rx="1.5"/><rect x="16.5" y="6" width="3" height="14" rx="1.5"/><rect x="21" y="9" width="1" height="0"/><circle cx="4.5" cy="9" r="2" fill="#a78bfa"/><circle cx="9" cy="12" r="2" fill="#a78bfa"/><circle cx="13.5" cy="7" r="2" fill="#a78bfa"/><circle cx="18" cy="10" r="2" fill="#a78bfa"/></svg>'},
  ];

  var pageMap={};
  var pageBuilders={main:buildMainPage,loud:buildLoudnessPage,eq:buildEqualizerPage,voice:buildVoicePage,effects:buildEffectsPage,reverb:buildReverbPage,mp3:buildMP3Page,settings:buildSettingsPage,gainrack:buildGainRackPage};

  var _curPageId=null;
  function switchPage(id){
    if(_curPageId&&pageMap[_curPageId]&&pageMap[_curPageId]._onHide)pageMap[_curPageId]._onHide();
    ST.page=id;_curPageId=id;
    content.querySelectorAll('.rc-page').forEach(function(p){p.classList.remove('active');});
    sidebar.querySelectorAll('.rc-nav').forEach(function(b){b.classList.remove('active');});
    if(!pageMap[id]&&pageBuilders[id]){var pg=pageBuilders[id]();pageMap[id]=pg;content.appendChild(pg);}
    if(pageMap[id]){pageMap[id].classList.add('active');if(pageMap[id]._onShow)pageMap[id]._onShow();}
    var nb=sidebar.querySelector('[data-page="'+id+'"]');if(nb)nb.classList.add('active');
  }

  navDef.forEach(function(n){
    var item=document.createElement('div');item.className='rc-nav';item.dataset.page=n.id;
    item.innerHTML=n.svg+'<span>'+n.label+'</span>';
    item.addEventListener('click',function(){switchPage(n.id);});
    sidebar.appendChild(item);
  });

  /* Sidebar footer */
  var foot=document.createElement('div');foot.className='rc-sidebar-foot';
  var mr2=document.createElement('div');mr2.className='rc-mic-row';
  var md2=document.createElement('div');md2.className='rc-mic-dot';md2.id='rc-micdot2';
  var ml2=document.createElement('span');ml2.id='rc-mictext2';ml2.className='rc-mic-label';ml2.textContent='Mic: Waiting';
  mr2.append(md2,ml2);
  var ms=document.createElement('div');ms.className='rc-foot-sub';ms.textContent='48kHz / AudioWorklet';
  foot.append(mr2,ms);sidebar.appendChild(foot);

  body.append(sidebar,content);
  panel.append(titleBar,body);
  document.body.appendChild(panel);

  /* Draggable */
  var drag=false,ox=0,oy=0;
  titleBar.addEventListener('mousedown',function(e){if(e.target.classList.contains('rc-wbtn'))return;drag=true;ox=e.clientX-panel.offsetLeft;oy=e.clientY-panel.offsetTop;});
  document.addEventListener('mousemove',function(e){if(!drag)return;panel.style.left=Math.max(0,Math.min(window.innerWidth-panel.offsetWidth,e.clientX-ox))+'px';panel.style.top=Math.max(0,Math.min(window.innerHeight-panel.offsetHeight,e.clientY-oy))+'px';});
  document.addEventListener('mouseup',function(){if(drag){drag=false;try{localStorage.setItem(POSK,JSON.stringify({l:panel.style.left,t:panel.style.top}));}catch(e){}}});
  titleBar.addEventListener('touchstart',function(e){var t=e.touches[0];drag=true;ox=t.clientX-panel.offsetLeft;oy=t.clientY-panel.offsetTop;},{passive:true});
  document.addEventListener('touchmove',function(e){if(!drag)return;var t=e.touches[0];panel.style.left=Math.max(0,Math.min(window.innerWidth-panel.offsetWidth,t.clientX-ox))+'px';panel.style.top=Math.max(0,Math.min(window.innerHeight-panel.offsetHeight,t.clientY-oy))+'px';},{passive:true});
  document.addEventListener('touchend',function(){drag=false;});

  /* Window buttons */
  var coll=false;
  minBtn.addEventListener('click',function(){coll=!coll;panel.classList.toggle('coll',coll);minBtn.textContent=coll?'□':'−';});
  maxBtn.addEventListener('click',function(){if(panel.style.width==='100vw'){panel.style.width='1000px';panel.style.height='660px';}else{panel.style.width='100vw';panel.style.height='100vh';panel.style.left='0';panel.style.top='0';}});
  closeBtn.addEventListener('click',function(){panel.style.display='none';fab.style.display='flex';viz.classList.remove('show');});
  fab.addEventListener('click',function(){panel.style.display='flex';fab.style.display='none';viz.classList.add('show');setTimeout(function(){switchPage(ST.page||'main');},20);});

  /* Restore position */
  try{var pos=JSON.parse(localStorage.getItem(POSK)||'{}');if(pos.l)panel.style.left=pos.l;if(pos.t)panel.style.top=pos.t;}catch(e){}

  /* VU meter (22 LEDs on main page) */
  var vuBuf=new Uint8Array(1024);
  var peakHold=0,peakTimer=0;
  function animVU(){
    requestAnimationFrame(animVU);
    if(!CHAIN.an)return;
    CHAIN.an.getByteTimeDomainData(vuBuf);
    var pk=0;for(var i=0;i<vuBuf.length;i++){var v=Math.abs((vuBuf[i]-128)/128);if(v>pk)pk=v;}
    if(pk>peakHold){peakHold=pk;peakTimer=40;}else{peakTimer--;if(peakTimer<0)peakHold=peakHold*0.97;}
    var pct=Math.min(1,pk*1.5);var numLit=Math.round(pct*22);
    for(var li=0;li<22;li++){
      var el=document.getElementById('led-'+li);if(!el)continue;
      if(li<numLit){el.className=li<14?'rc-led lit':(li<18?'rc-led lit-y':'rc-led lit-r');}
      else el.className='rc-led';
    }
    var pctEl=document.getElementById('led-pct');if(pctEl)pctEl.textContent=Math.round(pct*100)+'%';

    /* Animate viz bars */
    var bars=document.querySelectorAll('.rc-viz-bar');
    if(bars.length){
      bars.forEach(function(b,i){var h=0.4+pct*(0.4+Math.sin(Date.now()/200+i*1.2)*0.2);b.style.transform='scaleY('+Math.max(0.1,h).toFixed(2)+')';});
    }
  }
  requestAnimationFrame(animVU);

  setTimeout(function(){switchPage(ST.page||'main');},30);
}

/* ─── BOOT ─────────────────────────────────────────────────────── */
loadState();
(function tryBuild(){if(document.body)buildUI();else setTimeout(tryBuild,100);})();

})();
