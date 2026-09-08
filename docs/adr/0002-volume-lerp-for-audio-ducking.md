---
status: accepted
date: 2026-09-08
---

# 2. HTMLMediaElement Volume Lerp for Audio Ducking

We decided to implement Audio Ducking by animating `HTMLMediaElement.volume` using `requestAnimationFrame` linear interpolation (150ms crossfade), rather than using the Web Audio API `AudioContext.createMediaElementSource()` and `GainNode`. While `GainNode` is the standard Web Audio approach, YouTube streams video and audio from cross-origin CDN domains (`*.googlevideo.com`) without permissive CORS headers, causing `MediaElementAudioSourceNode` to output silence. Direct property interpolation bypasses CORS restrictions entirely while delivering smooth volume transitions.

## Consequences & Audio Visualization Constraint

Because `MediaElementAudioSourceNode` cannot capture YouTube's video stream without CORS restrictions, Web Audio `AnalyserNode` cannot be attached to the video element. Consequently, audio visualizers and equalizer bars (specified in `DESIGN.md`) cannot perform real-time Fast Fourier Transform (FFT) frequency analysis directly on YouTube's media stream. Instead, equalizer animations are event-driven—synchronized with synthesized Dub Track playback events and segment duration timers, or analyzed exclusively from decoded client-side TTS audio blobs. Implementers must not attempt to connect `AudioContext` to YouTube's `HTMLMediaElement`.
