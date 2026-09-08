# 05: Persistent Local Audio & Transcript Cache (IndexedDB)

**What to build:** A persistent client-side caching layer using browser IndexedDB. Saves translated transcripts and synthesized audio blobs keyed by `videoId_language_voiceId`. When scrubbing, replaying, or reopening a previously watched video, audio segments load instantly in 0ms without hitting external network endpoints. Provides cache storage usage metrics and a purge operation.

**Blocked by:** 03: Upfront Translation Pipeline with Gemini Flash, 04: Microsoft Edge Neural TTS Streaming via Service Worker

**Status:** ready-for-agent

- [ ] IndexedDB repository initializes with stores for transcripts and audio blobs.
- [ ] Save and retrieve operations support fast keyed lookups by video, language, and voice ID.
- [ ] Cache size calculation utility aggregates stored blob bytes for display in settings.
- [ ] Purge operation safely wipes all cached audio blobs and transcripts on user command.
- [ ] Unit test suite using `fake-indexeddb` verifies store, fetch, cache-hit, and purge lifecycles.
