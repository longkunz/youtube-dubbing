import React, { useState, useEffect } from 'react';
import { FloatingPill } from './FloatingPill';
import { CyberCockpit } from './CyberCockpit';
import { SubtitleOverlay } from './SubtitleOverlay';
import { NotificationBanner } from './NotificationBanner';

import type { DubbingOrchestrator, Segment, VoiceProfile } from '../types/domain';
import { DEFAULT_HOAI_MY_VOICE, DEFAULT_NAM_MINH_VOICE } from '../core/tts/voices';

export interface HudContainerProps {
  orchestrator?: DubbingOrchestrator;
  initialIsOpen?: boolean;
  initialIsEnabled?: boolean;
  initialTargetLanguage?: string;
  initialVoiceId?: string;
  initialDuckLevel?: number;
  initialActiveSegment?: Segment | null;
  initialIsMultiSpeakerEnabled?: boolean;

  // Direct overrides (for testing or declarative use)
  isOpen?: boolean;
  isEnabled?: boolean;
  targetLanguage?: string;
  selectedVoiceId?: string;
  duckLevel?: number;
  activeSegment?: Segment | null;
  isPlaying?: boolean;
  isDucked?: boolean;
  showOriginalText?: boolean;
  isMultiSpeakerEnabled?: boolean;
  onToggleMultiSpeaker?: (enabled: boolean) => void;

  // Caption resilience flags
  hasCaptions?: boolean;
  isNoCaptions?: boolean;
  onConfigureSettings?: () => void;
}


export const HudContainer: React.FC<HudContainerProps> = ({
  orchestrator,
  initialIsOpen = false,
  initialIsEnabled = true,
  initialTargetLanguage = 'vi',
  initialVoiceId = 'vi-VN-HoaiMyNeural',
  initialDuckLevel = 0.2,
  initialActiveSegment = null,
  initialIsMultiSpeakerEnabled = false,
  isOpen: controlledIsOpen,
  isEnabled: controlledIsEnabled,
  targetLanguage: controlledTargetLanguage,
  selectedVoiceId: controlledSelectedVoiceId,
  duckLevel: controlledDuckLevel,
  activeSegment: controlledActiveSegment,
  isPlaying: controlledIsPlaying,
  isDucked: controlledIsDucked,
  showOriginalText = true,
  isMultiSpeakerEnabled: controlledIsMultiSpeaker,
  onToggleMultiSpeaker,
  hasCaptions,
  isNoCaptions,
  onConfigureSettings,
}) => {
  const [isOpenState, setIsOpenState] = useState(initialIsOpen);
  const [isEnabledState, setIsEnabledState] = useState(initialIsEnabled);
  const [targetLanguageState, setTargetLanguageState] = useState(initialTargetLanguage);
  const [selectedVoiceIdState, setSelectedVoiceIdState] = useState(initialVoiceId);
  const [duckLevelState, setDuckLevelState] = useState(initialDuckLevel);
  const [activeSegmentState, setActiveSegmentState] = useState<Segment | null>(initialActiveSegment);
  const [isPlayingState, setIsPlayingState] = useState(false);
  const [isDuckedState, setIsDuckedState] = useState(false);
  const [isBannerDismissed, setIsBannerDismissed] = useState(false);
  const [isMultiSpeakerState, setIsMultiSpeakerState] = useState(
    initialIsMultiSpeakerEnabled ?? orchestrator?.isDiarizationEnabled?.() ?? false
  );

  const captionsAvailable =
    hasCaptions !== undefined ? hasCaptions : isNoCaptions !== undefined ? !isNoCaptions : true;

  useEffect(() => {
    if (captionsAvailable) {
      setIsBannerDismissed(false);
    }
  }, [captionsAvailable]);


  // Sync with orchestrator if available
  useEffect(() => {
    if (!orchestrator) return;

    const syncState = () => {
      try {
        const state = orchestrator.getState();
        if (state.targetLanguage && state.targetLanguage !== targetLanguageState) {
          setTargetLanguageState(state.targetLanguage);
        }
        if (orchestrator.getActiveSegment) {
          const seg = orchestrator.getActiveSegment();
          setActiveSegmentState(seg);
        }
        if (orchestrator.isDiarizationEnabled) {
          setIsMultiSpeakerState(orchestrator.isDiarizationEnabled());
        }
        if (orchestrator.isDucked) {
          setIsDuckedState(orchestrator.isDucked());
        } else if (state.activeSegmentId) {
          setIsDuckedState(true);
        } else {
          setIsDuckedState(false);
        }
        setIsPlayingState(state.status === 'playing' || Boolean(state.activeSegmentId));
      } catch {
        // Safe check
      }
    };

    syncState();
    const interval = setInterval(syncState, 100);
    return () => clearInterval(interval);
  }, [orchestrator, targetLanguageState]);

  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : isOpenState;
  const isEnabled = controlledIsEnabled !== undefined ? controlledIsEnabled : isEnabledState;
  const targetLanguage = controlledTargetLanguage !== undefined ? controlledTargetLanguage : targetLanguageState;
  const selectedVoiceId = controlledSelectedVoiceId !== undefined ? controlledSelectedVoiceId : selectedVoiceIdState;
  const duckLevel = controlledDuckLevel !== undefined ? controlledDuckLevel : duckLevelState;
  const activeSegment = controlledActiveSegment !== undefined ? controlledActiveSegment : activeSegmentState;
  const isPlaying = controlledIsPlaying !== undefined ? controlledIsPlaying : isPlayingState;
  const isDucked = controlledIsDucked !== undefined ? controlledIsDucked : isDuckedState;
  const isMultiSpeaker = controlledIsMultiSpeaker !== undefined ? controlledIsMultiSpeaker : isMultiSpeakerState;

  const handleToggle = () => {
    setIsOpenState((prev) => !prev);
  };

  const handleClose = () => {
    setIsOpenState(false);
  };

  const handleToggleEnabled = (enabled: boolean) => {
    setIsEnabledState(enabled);
    if (orchestrator) {
      if (!enabled) {
        orchestrator.handlePause();
      } else {
        orchestrator.handlePlay();
      }
    }
  };

  const handleToggleMultiSpeaker = (enabled: boolean) => {
    setIsMultiSpeakerState(enabled);
    if (orchestrator?.setDiarizationEnabled) {
      orchestrator.setDiarizationEnabled(enabled);
    }
    onToggleMultiSpeaker?.(enabled);
  };

  const handleSelectLanguage = (languageCode: string) => {
    setTargetLanguageState(languageCode);
    orchestrator?.setTargetLanguage?.(languageCode);
  };

  const handleSelectVoice = (voiceId: string) => {
    setSelectedVoiceIdState(voiceId);
    if (orchestrator) {
      const profile: VoiceProfile =
        voiceId === DEFAULT_NAM_MINH_VOICE.id ? DEFAULT_NAM_MINH_VOICE : DEFAULT_HOAI_MY_VOICE;
      if (orchestrator.setVoiceProfile) {
        orchestrator.setVoiceProfile(profile);
      }
    }
  };

  const handleDuckLevelChange = (newLevel: number) => {
    setDuckLevelState(newLevel);
    if (orchestrator && orchestrator.setDuckLevel) {
      orchestrator.setDuckLevel(newLevel);
    }
  };

  return (
    <div className="hud-wrapper">
      {!captionsAvailable && !isBannerDismissed && (
        <NotificationBanner
          onConfigureSettings={onConfigureSettings}
          onDismiss={() => setIsBannerDismissed(true)}
        />
      )}
      <FloatingPill isOpen={isOpen} onToggle={handleToggle} />

      <CyberCockpit
        isOpen={isOpen}
        onClose={handleClose}
        isEnabled={isEnabled}
        onToggleEnabled={handleToggleEnabled}
        isMultiSpeakerEnabled={isMultiSpeaker}
        onToggleMultiSpeaker={handleToggleMultiSpeaker}
        targetLanguage={targetLanguage}
        onSelectLanguage={handleSelectLanguage}
        selectedVoiceId={selectedVoiceId}
        onSelectVoice={handleSelectVoice}
        duckLevel={duckLevel}
        onDuckLevelChange={handleDuckLevelChange}
        isPlaying={isPlaying}
        isDucked={isDucked}
      />
      <SubtitleOverlay
        segment={activeSegment}
        visible={isEnabled}
        showOriginalText={showOriginalText}
      />
    </div>
  );
};
