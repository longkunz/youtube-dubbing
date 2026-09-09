/**
 * Edge-TTS voice preview (used by the Options Command Center "Preview" button).
 *
 * Plays a synthesized audio Blob through an HTMLAudioElement so the user can
 * verify end-to-end that Edge TTS synthesis + audible playback actually work.
 * Audio creation and object-URL handling are injectable for unit tests
 * (jsdom has neither working Audio playback nor URL.createObjectURL).
 */

export const TTS_PREVIEW_TEXT = 'Xin chào, đây là giọng đọc thử của AetherDub.';

/** Minimal audio surface needed for preview playback. Satisfied by HTMLAudioElement. */
export interface PreviewAudio {
  play: () => Promise<void> | void;
  pause: () => void;
  onended: ((() => void) | null);
  onerror: ((() => void) | null);
}

export interface PreviewPlayback {
  /** Stop playback immediately and release the object URL. */
  stop: () => void;
  /** Resolves when playback ends naturally, rejects on audio element error. */
  ended: Promise<void>;
}

/**
 * Play a synthesized audio Blob and resolve when it finishes.
 *
 * @param blob - Audio data from Edge TTS (e.g. via BackgroundDubbingTtsClient).
 * @param createAudio - Factory for the audio element (defaults to `new Audio(url)`).
 * @param revokeObjectUrl - Defaults to URL.revokeObjectURL (noop fallback).
 */
export function playAudioBlob(
  blob: Blob,
  createAudio: (url: string) => PreviewAudio = (url) => new Audio(url) as unknown as PreviewAudio,
  revokeObjectUrl: (url: string) => void = (url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Non-fatal: object URL leak is bounded to one preview sample.
    }
  }
): PreviewPlayback {
  const createUrl: (blob: Blob) => string =
    typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
      ? (b) => URL.createObjectURL(b)
      : () => '';
  const audioUrl = createUrl(blob);
  const audio = createAudio(audioUrl);

  let settleEnded: () => void = () => {};
  let rejectEnded: (err: Error) => void = () => {};
  const ended = new Promise<void>((resolve, reject) => {
    settleEnded = () => {
      revokeObjectUrl(audioUrl);
      resolve();
    };
    rejectEnded = (err: Error) => {
      revokeObjectUrl(audioUrl);
      reject(err);
    };
  });

  audio.onended = () => settleEnded();
  audio.onerror = () => rejectEnded(new Error('Preview audio element reported an error during playback'));

  // Start playback; a rejected play() (e.g. autoplay policy) surfaces via `ended`.
  try {
    const maybePromise = audio.play();
    if (maybePromise && typeof (maybePromise as Promise<void>).catch === 'function') {
      (maybePromise as Promise<void>).catch((err: unknown) => {
        rejectEnded(err instanceof Error ? err : new Error(String(err)));
      });
    }
  } catch (err) {
    rejectEnded(err instanceof Error ? err : new Error(String(err)));
  }

  return {
    stop: () => {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } finally {
        // Settle `ended` so awaiting callers never hang (rejectEnded also
        // revokes the object URL exactly once); callers distinguish
        // user-stop from real errors via the message.
        rejectEnded(new Error('Preview playback stopped by user'));
      }
    },
    ended,
  };
}
