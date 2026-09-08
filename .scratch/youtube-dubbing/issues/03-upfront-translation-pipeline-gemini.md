# 03: Upfront Translation Pipeline with Gemini Flash

**What to build:** A high-speed batch translation pipeline using Google Gemini 1.5/2.0 Flash. Upon receiving a restructured `Transcript`, the pipeline issues a single structured batch request to Gemini with instructions to translate foreign dialogue into natural, fluent Vietnamese while strictly preserving technical terminology, contextual pronouns, and segment ID mappings.

**Blocked by:** 02: Transcript Extraction & Gap-Based Sentence Restructuring

**Status:** ready-for-agent

- [ ] Gemini client initializes using user's stored API key from `chrome.storage.local`.
- [ ] System prompt instructs the model to translate with conversational naturalness, consistent pronouns, and structured JSON output.
- [ ] Pipeline maps translated sentences back to original `Segment` objects, enriching each with `translatedText`.
- [ ] Rate limits and network errors are trapped with user-friendly error codes.
- [ ] Unit tests with mocked Gemini responses verify correct JSON parsing, boundary preservation, and error handling.
