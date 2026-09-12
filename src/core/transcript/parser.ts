import { Segment } from '../../types/domain';

/**
 * Decode HTML entities in caption text across both browser and Node/worker environments
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Parse YouTube XML timedtext into normalized Segments
 */
export function parseTimedTextXml(xmlText: string): Segment[] {
  if (!xmlText || typeof xmlText !== 'string') {
    return [];
  }

  const segments: Segment[] = [];
  // Matches <text start="1.23" dur="4.56">...</text>
  const regex = /<text\s+[^>]*?start="([0-9.]+)"[^>]*?dur="([0-9.]+)"[^>]*>([\s\S]*?)<\/text>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = regex.exec(xmlText)) !== null) {
    const startTime = parseFloat(match[1]);
    const duration = parseFloat(match[2]);
    const rawContent = match[3];

    // Strip inner tags if any, e.g. <b> or font tags
    const cleanContent = rawContent.replace(/<[^>]+>/g, '');
    const decodedText = decodeHtmlEntities(cleanContent).trim();

    if (decodedText.length > 0) {
      segments.push({
        id: `xml-seg-${index + 1}`,
        startTime: Number(startTime.toFixed(3)),
        duration: Number(duration.toFixed(3)),
        endTime: Number((startTime + duration).toFixed(3)),
        sourceText: decodedText
      });
      index++;
    }
  }

  return segments;
}

/**
 * Parse YouTube JSON3 timedtext into normalized Segments
 */
export function parseTimedTextJson(jsonOrString: string | any): Segment[] {
  if (!jsonOrString) return [];

  let data: any;
  if (typeof jsonOrString === 'string') {
    try {
      data = JSON.parse(jsonOrString);
    } catch {
      return [];
    }
  } else {
    data = jsonOrString;
  }

  if (!data || !Array.isArray(data.events)) {
    return [];
  }

  const segments: Segment[] = [];
  let index = 0;

  for (const event of data.events) {
    if (!event || !Array.isArray(event.segs) || event.segs.length === 0) {
      continue;
    }

    const rawText = event.segs.map((s: any) => s.utf8 || '').join('');
    const decodedText = decodeHtmlEntities(rawText).trim();

    if (decodedText.length === 0 || decodedText === '\n') {
      continue;
    }

    const startTime = Number(((event.tStartMs || 0) / 1000).toFixed(3));
    const duration = Number(((event.dDurationMs || 0) / 1000).toFixed(3));
    const endTime = Number((startTime + duration).toFixed(3));

    segments.push({
      id: `json-seg-${index + 1}`,
      startTime,
      duration,
      endTime,
      sourceText: decodedText
    });
    index++;
  }

  return segments;
}
