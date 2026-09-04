REXX ULTRA POST-DSP LAYER v1

- Adds a separate post-DSP loudness/features layer AFTER the existing RH chain.
- Existing Loud/voice/effects engine is not replaced.
- Ultra Gain + Preamp provide additional gain above the existing postGain.
- Compressor and limiter are in the Ultra layer and remain independent.
- 20 adjustable controls are exposed in a separate REXX ULTRA panel.
- Defaults are transparent except limiter/mix safety defaults.
- 3002 rescue: pipeline creation falls back to the raw mic; getUserMedia errors retry with raw audio.

20 controls:
Ultra Gain, Preamp, Low Boost, Low Cut, Mid Boost, Presence, Air, Clarity,
Warmth, Saturation, Soft Clip, Compressor, Limiter, Attack, Release, Gate,
Stereo Width, Balance, Exciter, Output Mix.

IMPORTANT:
This is intended to be loaded where the current injector.js is loaded. Do not run
another copy of the old extension audio engine alongside it, because that would
create competing AudioContext/getUserMedia patches.
