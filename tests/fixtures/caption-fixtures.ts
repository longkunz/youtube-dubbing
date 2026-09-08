/**
 * Real-world test fixtures for YouTube timedtext captions (XML and JSON3)
 */

export const REAL_WORLD_XML_TIMEDTEXT = `<?xml version="1.0" encoding="utf-8" ?>
<transcript>
  <text start="0.45" dur="1.20">Hello everyone &amp; welcome</text>
  <text start="1.80" dur="0.85">back to the channel.</text>
  <text start="3.15" dur="1.10">Today we are going to</text>
  <text start="4.30" dur="1.45">explore AI dubbing technology.</text>
  <text start="6.80" dur="1.20">This is after a long pause.</text>
</transcript>`;

export const REAL_WORLD_JSON3_TIMEDTEXT = {
  wireMagic: "pb3",
  events: [
    {
      tStartMs: 500,
      dDurationMs: 900,
      segs: [{ utf8: "In this " }, { utf8: "video," }]
    },
    {
      tStartMs: 1450, // gap = 1450 - (500 + 900) = 50ms (< 400ms)
      dDurationMs: 1100,
      segs: [{ utf8: " we will " }, { utf8: "build a chrome extension." }]
    },
    {
      tStartMs: 3500, // gap = 3500 - (1450 + 1100) = 950ms (>= 400ms)
      dDurationMs: 1200,
      segs: [{ utf8: "It supports " }, { utf8: "real-time dubbing." }]
    },
    {
      tStartMs: 4750, // gap = 4750 - (3500 + 1200) = 50ms (< 400ms)
      dDurationMs: 1000,
      segs: [{ utf8: "Let's test it out!" }]
    }
  ]
};

export const FRAGMENTED_AUTO_GENERATED_SEGMENTS = [
  // Sentence 1: "The quick brown fox jumps over the lazy dog."
  // Fragmented into 4 chunks with small gaps < 0.4s
  {
    id: "raw-1",
    startTime: 1.0,
    endTime: 1.5,
    duration: 0.5,
    sourceText: "The quick"
  },
  {
    id: "raw-2",
    startTime: 1.6, // gap = 0.1s (< 0.4s)
    endTime: 2.1,
    duration: 0.5,
    sourceText: "brown fox"
  },
  {
    id: "raw-3",
    startTime: 2.3, // gap = 0.2s (< 0.4s)
    endTime: 2.8,
    duration: 0.5,
    sourceText: "jumps over"
  },
  {
    id: "raw-4",
    startTime: 3.0, // gap = 0.2s (< 0.4s)
    endTime: 3.7,
    duration: 0.7,
    sourceText: "the lazy dog."
  },
  // Sentence 2: gap >= 0.4s (4.5 - 3.7 = 0.8s silence)
  {
    id: "raw-5",
    startTime: 4.5, // gap = 0.8s (>= 0.4s)
    endTime: 5.2,
    duration: 0.7,
    sourceText: "It was really fast."
  },
  // Sentence 3: starts after 0.5s pause
  {
    id: "raw-6",
    startTime: 5.7,
    endTime: 6.2,
    duration: 0.5,
    sourceText: "And then"
  },
  {
    id: "raw-7",
    startTime: 6.3, // gap = 0.1s
    endTime: 7.0,
    duration: 0.7,
    sourceText: "it disappeared!"
  }
];
