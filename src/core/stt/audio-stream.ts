import type { Segment } from '../../types/domain';

interface AdaptiveFormat {
  mimeType?: string;
  url?: string;
  signatureCipher?: string;
}

interface PlayerResponseLike {
  streamingData?: {
    adaptiveFormats?: AdaptiveFormat[];
    formats?: AdaptiveFormat[];
  };
}

/**
 * Pick a CORS-fetchable audio URL from ytInitialPlayerResponse.
 * Ciphered formats (`signatureCipher`) cannot be used without YouTube's
 * n-sig solver — those are skipped rather than guessed.
 */
export function extractUnsignedAudioUrl(playerResponse: unknown): string | null {
  if (!playerResponse || typeof playerResponse !== 'object') return null;
  const data = playerResponse as PlayerResponseLike;
  const formats = [
    ...(data.streamingData?.adaptiveFormats ?? []),
    ...(data.streamingData?.formats ?? []),
  ];
  const audio = formats.find(
    (format) =>
      typeof format.url === 'string' &&
      format.url.length > 0 &&
      !format.signatureCipher &&
      /audio\//i.test(format.mimeType ?? ''),
  );
  return audio?.url ?? null;
}

export interface WhisperVerboseSegment {
  start?: number;
  end?: number;
  text?: string;
}

export function whisperSegmentsToDomain(raw: WhisperVerboseSegment[]): Segment[] {
  return raw
    .map((item, index) => {
      const startTime = typeof item.start === 'number' ? item.start : 0;
      const endTime = typeof item.end === 'number' ? item.end : startTime;
      const sourceText = (item.text ?? '').trim();
      return {
        id: `stt-${index}`,
        startTime,
        endTime,
        duration: Math.max(0, endTime - startTime),
        sourceText,
      };
    })
    .filter((segment) => segment.sourceText.length > 0);
}
