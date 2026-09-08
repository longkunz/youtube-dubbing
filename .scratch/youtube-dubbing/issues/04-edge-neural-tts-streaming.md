# 04: Microsoft Edge Neural TTS Streaming via Service Worker

**What to build:** A WebSocket-based speech synthesis client running inside the Background Service Worker. Given a translated text string and voice profile (`vi-VN-HoaiMyNeural` or `vi-VN-NamMinhNeural`), the client establishes a secure WebSocket connection to Microsoft Edge TTS, frames SSML synthesis requests, accumulates streaming binary audio chunks, and outputs playable MP3 `Blob` objects.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Background service worker creates and manages WebSocket connections to `wss://speech.platform.bing.com`.
- [ ] SSML generator formats requests with pitch, rate, and voice profile parameters.
- [ ] Incoming binary audio buffers are parsed, assembled, and converted to valid `Blob (audio/mpeg)` objects.
- [ ] Automatic retry logic handles dropped WebSocket connections with up to 3 retries and exponential backoff.
- [ ] Automated test suite verifies SSML generation, binary frame parsing, and reconnection behavior.
