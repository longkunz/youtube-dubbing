# 02: Transcript Extraction & Gap-Based Sentence Restructuring

**What to build:** An automated caption extraction and sentence restructuring engine. For any valid YouTube video, the engine retrieves the official or auto-generated captions (XML or JSON) via YouTube's internal player transcript API. It then feeds the fragmented segments through `SentenceMerger` to consolidate chunks separated by gaps < 0.4s into complete, grammatical sentences with preserved timeline boundaries (`startTime` and `endTime`).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Fetcher retrieves timedtext captions for any YouTube video ID (supporting both author-uploaded CC and auto-generated transcripts).
- [ ] Raw caption chunks are parsed into normalized `Segment` objects with accurate start and end timestamps.
- [ ] `SentenceMerger` algorithm consolidates consecutive short fragments with silence gaps < 0.4s into cohesive sentence units.
- [ ] Merged sentences retain overall start time of the first fragment and end time of the last fragment.
- [ ] Unit test suite verifies sentence restructuring against real-world fragmented YouTube caption fixtures.
