import { describe, it, expect } from 'vitest';
import { parseTimedTextXml, parseTimedTextJson } from '../src/core/transcript/parser';
import { REAL_WORLD_XML_TIMEDTEXT, REAL_WORLD_JSON3_TIMEDTEXT } from './fixtures/caption-fixtures';

describe('TranscriptParser', () => {
  describe('parseTimedTextXml', () => {
    it('parses valid YouTube XML timedtext into normalized Segments', () => {
      const segments = parseTimedTextXml(REAL_WORLD_XML_TIMEDTEXT);
      expect(segments).toHaveLength(5);

      // Segment 1
      expect(segments[0].startTime).toBeCloseTo(0.45);
      expect(segments[0].duration).toBeCloseTo(1.20);
      expect(segments[0].endTime).toBeCloseTo(1.65);
      expect(segments[0].sourceText).toBe('Hello everyone & welcome'); // &amp; decoded

      // Segment 2
      expect(segments[1].startTime).toBeCloseTo(1.80);
      expect(segments[1].duration).toBeCloseTo(0.85);
      expect(segments[1].endTime).toBeCloseTo(2.65);
      expect(segments[1].sourceText).toBe('back to the channel.');
    });

    it('decodes HTML entities including quotes and apostrophes', () => {
      const xml = `<transcript><text start="1.0" dur="2.0">It&#39;s &quot;AI Dubbing&quot; &amp; more &lt;tag&gt;</text></transcript>`;
      const segments = parseTimedTextXml(xml);
      expect(segments[0].sourceText).toBe('It\'s "AI Dubbing" & more <tag>');
    });

    it('handles empty XML or transcript without text nodes gracefully', () => {
      expect(parseTimedTextXml('')).toEqual([]);
      expect(parseTimedTextXml('<transcript></transcript>')).toEqual([]);
      expect(parseTimedTextXml('invalid xml content')).toEqual([]);
    });
  });

  describe('parseTimedTextJson', () => {
    it('parses valid YouTube JSON3 timedtext into normalized Segments', () => {
      const segments = parseTimedTextJson(REAL_WORLD_JSON3_TIMEDTEXT);
      expect(segments).toHaveLength(4);

      // Segment 1: tStartMs: 500, dDurationMs: 900
      expect(segments[0].startTime).toBeCloseTo(0.5);
      expect(segments[0].duration).toBeCloseTo(0.9);
      expect(segments[0].endTime).toBeCloseTo(1.4);
      expect(segments[0].sourceText).toBe('In this video,');

      // Segment 2: tStartMs: 1450, dDurationMs: 1100
      expect(segments[1].startTime).toBeCloseTo(1.45);
      expect(segments[1].duration).toBeCloseTo(1.1);
      expect(segments[1].endTime).toBeCloseTo(2.55);
      expect(segments[1].sourceText).toBe('we will build a chrome extension.');
    });

    it('filters out empty events or newline events', () => {
      const json = {
        events: [
          { tStartMs: 100, dDurationMs: 200, segs: [{ utf8: "\n" }] },
          { tStartMs: 300, dDurationMs: 500, segs: [{ utf8: "Valid content" }] },
          { tStartMs: 900, dDurationMs: 100 } // no segs
        ]
      };
      const segments = parseTimedTextJson(json);
      expect(segments).toHaveLength(1);
      expect(segments[0].sourceText).toBe('Valid content');
    });

    it('handles JSON string as well as parsed object', () => {
      const jsonStr = JSON.stringify({
        events: [
          { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "Stringified input" }] }
        ]
      });
      const segments = parseTimedTextJson(jsonStr);
      expect(segments).toHaveLength(1);
      expect(segments[0].startTime).toBe(1);
      expect(segments[0].endTime).toBe(3);
      expect(segments[0].sourceText).toBe('Stringified input');
    });

    it('handles invalid JSON gracefully', () => {
      expect(parseTimedTextJson('not-json')).toEqual([]);
      expect(parseTimedTextJson(null as any)).toEqual([]);
    });
  });
});
