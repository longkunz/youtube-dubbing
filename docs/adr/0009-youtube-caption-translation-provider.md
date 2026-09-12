---
status: accepted
date: 2026-09-11
---

# 9. YouTube Caption Translation as a caption-acquisition provider

We added **YouTube Caption Translation** as a peer Translation Provider in Command Center (not a cockpit toggle, not a silent fallback). It obtains translated Segment text from YouTube Caption Tracks instead of an LLM, so the cheap/fast path does not call Gemini or an OpenAI-Compatible Endpoint and does not require those API keys.

This is **caption acquisition**, not `TranslationClient` batching. ADR-0007 stays the LLM seam (Gemini / OpenAI-compatible JSON + optional speaker diarization). The coordinator branches: LLM providers still fetch a source Caption Track, Sentence-Restructure, then `translateSegments`; YouTube Caption Translation fetches a target-language Caption Track when one exists, otherwise the source track's YouTube machine translation, dual-fetches source text for the original preview line, aligns by timestamp overlap, then Sentence Restructuring. One timedtext pass replaces the 8-segment LLM batches.

**Cache:** Segment Cache keys include Translation Provider so Gemini and YouTube transcripts/audio never collide.

**Failure:** If there is no target-language track and no translatable source track (or the translated fetch is empty/throttled), fail visibly. Do not auto-switch to an LLM. Whisper Fallback remains STT-only when source captions are missing.

**Diarization:** YouTube Caption Translation does not emit `speakerGender`. That is an explicit exception to ADR-0007's LLM JSON contract.

**Rejected:** Implementing this as a `YouTubeTranslationClient` on `translateSegments` (would re-fetch or ignore merged text); using YouTube translation as the default or as an automatic LLM fallback; sharing cache keys across providers; skipping Sentence Restructuring so TTS would speak raw caption fragments.
