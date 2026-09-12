import { describe, it, expect } from 'vitest';
import { cleanSpeechText, isSpeakableText } from '../src/core/tts/text-cleaner';

describe('Text Cleaner & Speech Detector for TTS', () => {
  describe('cleanSpeechText()', () => {
    it('strips bracketed music tags', () => {
      expect(cleanSpeechText('[Music]')).toBe('');
      expect(cleanSpeechText('[Âm nhạc]')).toBe('');
      expect(cleanSpeechText('[tiếng nhạc dạo]')).toBe('');
      expect(cleanSpeechText('Hello [Music] world')).toBe('Hello world');
      expect(cleanSpeechText('Xin chào [Âm nhạc] các bạn')).toBe('Xin chào các bạn');
    });

    it('strips parenthesized sound effect tags', () => {
      expect(cleanSpeechText('(Laughter)')).toBe('');
      expect(cleanSpeechText('(Applause)')).toBe('');
      expect(cleanSpeechText('Great job (Applause) everyone')).toBe('Great job everyone');
    });

    it('strips musical notes and special characters', () => {
      expect(cleanSpeechText('♪')).toBe('');
      expect(cleanSpeechText('♪ Lalala ♫')).toBe('Lalala');
      expect(cleanSpeechText('🎵 Music starts 🎶')).toBe('Music starts');
    });

    it('strips illegal XML 1.0 control characters', () => {
      const withControlChars = 'Hello\x00\x08World\x1F';
      expect(cleanSpeechText(withControlChars)).toBe('HelloWorld');
    });

    it('normalizes multiple spaces', () => {
      expect(cleanSpeechText('  Too    many   spaces   ')).toBe('Too many spaces');
    });

    it('handles empty and nullish inputs', () => {
      expect(cleanSpeechText('')).toBe('');
      expect(cleanSpeechText(null)).toBe('');
      expect(cleanSpeechText(undefined)).toBe('');
    });
  });

  describe('isSpeakableText()', () => {
    it('returns false for empty or whitespace-only text', () => {
      expect(isSpeakableText('')).toBe(false);
      expect(isSpeakableText('   ')).toBe(false);
      expect(isSpeakableText(null)).toBe(false);
      expect(isSpeakableText(undefined)).toBe(false);
    });

    it('returns false for music tags only', () => {
      expect(isSpeakableText('[Music]')).toBe(false);
      expect(isSpeakableText('[Âm nhạc]')).toBe(false);
      expect(isSpeakableText('(Laughter)')).toBe(false);
      expect(isSpeakableText('♪ ♪ ♪')).toBe(false);
    });

    it('returns false for punctuation and symbols only', () => {
      expect(isSpeakableText('...')).toBe(false);
      expect(isSpeakableText('---')).toBe(false);
      expect(isSpeakableText('!??')).toBe(false);
      expect(isSpeakableText('#__')).toBe(false);
    });

    it('returns true for normal English and Vietnamese sentences', () => {
      expect(isSpeakableText('Hello world')).toBe(true);
      expect(isSpeakableText('Xin chào các bạn đã quay trở lại.')).toBe(true);
      expect(isSpeakableText('123')).toBe(true);
      expect(isSpeakableText('[Music] Welcome back')).toBe(true);
    });
  });
});
