/**
 * Predefined Vietnamese voice profiles for ZeroTTS and Neural TTS.
 */

import type { VoiceProfile } from '../../types/domain';

/**
 * Default female Vietnamese voice — Mai Chi (ZeroTTS CPU real-time).
 */
export const DEFAULT_MAI_CHI_VOICE: VoiceProfile = {
  id: 'maichi',
  name: 'Mai Chi (ZeroTTS CPU)',
  gender: 'female',
  locale: 'vi-VN',
  provider: 'zerotts',
  voiceKey: 'maichi',
  pitch: '+0Hz',
  rate: '+0%',
};

/**
 * Default female Vietnamese voice — Hoài My Neural.
 */
export const DEFAULT_HOAI_MY_VOICE: VoiceProfile = {
  id: 'vi-VN-HoaiMyNeural',
  name: 'Hoài My',
  gender: 'female',
  locale: 'vi-VN',
  provider: 'edge',
  voiceKey: 'vi-VN-HoaiMyNeural',
  pitch: '+0Hz',
  rate: '+0%',
};

/**
 * Default male Vietnamese voice — Nam Minh Neural.
 */
export const DEFAULT_NAM_MINH_VOICE: VoiceProfile = {
  id: 'vi-VN-NamMinhNeural',
  name: 'Nam Minh',
  gender: 'male',
  locale: 'vi-VN',
  provider: 'edge',
  voiceKey: 'vi-VN-NamMinhNeural',
  pitch: '+0Hz',
  rate: '+0%',
};
