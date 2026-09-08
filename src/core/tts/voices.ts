/**
 * Predefined Vietnamese Neural TTS voice profiles for Edge TTS.
 */

import type { VoiceProfile } from '../../types/domain';

/**
 * Default female Vietnamese voice — Hoài My Neural.
 */
export const DEFAULT_HOAI_MY_VOICE: VoiceProfile = {
  id: 'vi-VN-HoaiMyNeural',
  name: 'Hoài My',
  gender: 'female',
  locale: 'vi-VN',
  provider: 'edge-tts',
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
  provider: 'edge-tts',
  voiceKey: 'vi-VN-NamMinhNeural',
  pitch: '+0Hz',
  rate: '+0%',
};
