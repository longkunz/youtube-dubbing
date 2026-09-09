import React, { useState, useEffect } from 'react';
import { FloatingPill } from './FloatingPill';
import { CyberCockpit } from './CyberCockpit';
import { SubtitleOverlay } from './SubtitleOverlay';
import { NotificationBanner } from './NotificationBanner';
import { PreparationOverlay, type PreparationOverlayMode } from './PreparationOverlay';

import type { DubbingOrchestrator, Segment, VoiceProfile } from '../types/domain';
import { DEFAULT_HOAI_MY_VOICE, DEFAULT_NAM_MINH_VOICE } from '../core/tts/voices';

export interface HudContainerProps {
  orchestrator?: DubbingOrchestrator;
  initialIsOpen?: boolean;
  /** Per ADR-0008: defaults to false when uninitialized, true if orchestrator already provided. */
  initialIsEnabled?: boolean;
  initialTargetLanguage?: string;
  initialVoiceId?: string;
  initialDuckLevel?: number;
  initialActiveSegment?: Segment | null;
  initialIsMultiSpeakerEnabled?: boolean;

  // Direct overrides (for testing or declarative use)
  isOpen?: boolean;
  isEnabled?: boolean;
  isPreparing?: boolean;
  preparationMode?: PreparationOverlayMode | null;
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

  /** Translation engine badge shown in the cockpit telemetry row. */
  engineLabel?: string;

  /**
   * Called when the user clicks the primary pill hit area to enable dubbing.
   * The caller (HudInstance / mount.tsx) is responsible for running activateDubbing().
   */
  onActivateDubbing?: () => void;
  /**
   * Called when the user disables dubbing via the pill or cockpit toggle.
   * The caller is responsible for running deactivateDubbing() / cleanup.
   */
  onDeactivateDubbing?: () => void;
  /**
   * Called when the user cancels during PreparationOverlay.
   */
  onCancelPreparation?: () => void;
  /**
   * Called when the user clicks the resume button on PreparationOverlay in autoplay-blocked mode.
   */
  onResumePlayback?: () => void;
}

export const HudContainer: React.FC<HudContainerProps> = ({
  orchestrator,
  initialIsOpen = false,
  initialIsEnabled,
  initialTargetLanguage = 'vi',
  initialVoiceId = 'vi-VN-HoaiMyNeural',
  initialDuckLevel = 0.2,
  initialActiveSegment = null,
  initialIsMultiSpeakerEnabled = false,
  isOpen: controlledIsOpen,
  isEnabled: controlledIsEnabled,
  isPreparing: controlledIsPreparing,
  preparationMode: controlledPreparationMode,
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
  engineLabel,
  onActivateDubbing,
  onDeactivateDubbing,
  onCancelPreparation,
  onResumePlayback,
}) => {
  const [isOpenState, setIsOpenState] = useState(initialIsOpen);
  // Default to true if orchestrator passed directly, false for passive mount (no orchestrator)
  const defaultEnabled = initialIsEnabled !== undefined ? initialIsEnabled : Boolean(orchestrator);
  const [isEnabledState, setIsEnabledState] = useState(defaultEnabled);
  const [isPreparingState, setIsPreparingState] = useState(false);
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
  const isPreparing = controlledIsPreparing !== undefined ? controlledIsPreparing : isPreparingState;
  const targetLanguage = controlledTargetLanguage !== undefined ? controlledTargetLanguage : targetLanguageState;
  const selectedVoiceId = controlledSelectedVoiceId !== undefined ? controlledSelectedVoiceId : selectedVoiceIdState;
  const duckLevel = controlledDuckLevel !== undefined ? controlledDuckLevel : duckLevelState;
  const activeSegment = controlledActiveSegment !== undefined ? controlledActiveSegment : activeSegmentState;
  const isPlaying = controlledIsPlaying !== undefined ? controlledIsPlaying : isPlayingState;
  const isDucked = controlledIsDucked !== undefined ? controlledIsDucked : isDuckedState;
  const isMultiSpeaker = controlledIsMultiSpeaker !== undefined ? controlledIsMultiSpeaker : isMultiSpeakerState;

  // Derive active preparation mode for overlay
  const effectivePreparationMode: PreparationOverlayMode | null =
    controlledPreparationMode !== undefined
      ? controlledPreparationMode
      : isPreparing
        ? 'preparing'
        : null;

  /** Toggle Cyber Cockpit open/close (secondary pill button) */
  const handleToggle = () => {
    setIsOpenState((prev) => !prev);
  };

  const handleClose = () => {
    setIsOpenState(false);
  };

  /**
   * Split Pill primary action — toggle dubbing ON or OFF.
   */
  const handleToggleDubbing = () => {
    if (isEnabled || isPreparing) {
      // Turn OFF
      setIsEnabledState(false);
      setIsPreparingState(false);
      onDeactivateDubbing?.();
    } else {
      // Turn ON — caller handles actual pipeline launch
      onActivateDubbing?.();
    }
  };

  /** Cockpit toggle for the "Dub Track Audio" switch inside CyberCockpit */
  const handleToggleEnabled = (enabled: boolean) => {
    if (enabled) {
      setIsEnabledState(true);
      if (orchestrator) {
        orchestrator.handlePlay();
      }
      onActivateDubbing?.();
    } else {
      setIsEnabledState(false);
      setIsPreparingState(false);
      onDeactivateDubbing?.();
      if (orchestrator) {
        orchestrator.handlePause();
      }
    }
  };

  const handleCancelPreparation = () => {
    setIsPreparingState(false);
    setIsEnabledState(false);
    if (onCancelPreparation) {
      onCancelPreparation();
    } else {
      onDeactivateDubbing?.();
    }
  };

  const handleResumePlayback = () => {
    onResumePlayback?.();
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

  const handleOpenSettings = () => {
    if (onConfigureSettings) {
      onConfigureSettings();
      return;
    }
    if (typeof chrome !== 'undefined' && chrome?.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({ action: 'OPEN_OPTIONS_PAGE' }, () => {
          if (chrome.runtime?.lastError && chrome.runtime?.openOptionsPage) {
            chrome.runtime.openOptionsPage();
          }
        });
      } catch {
        if (chrome.runtime?.openOptionsPage) {
          chrome.runtime.openOptionsPage();
        }
      }
    } else if (typeof chrome !== 'undefined' && chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
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
      <FloatingPill
        isOpen={isOpen}
        isEnabled={isEnabled}
        isPreparing={isPreparing}
        onToggleDubbing={handleToggleDubbing}
        onToggleCockpit={handleToggle}
      />

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
        onOpenSettings={handleOpenSettings}
        engineLabel={engineLabel}
      />
      <SubtitleOverlay
        segment={activeSegment}
        visible={isEnabled}
        showOriginalText={showOriginalText}
      />

      {effectivePreparationMode && (
        <PreparationOverlay
          mode={effectivePreparationMode}
          onCancel={handleCancelPreparation}
          onResume={handleResumePlayback}
        />
      )}
    </div>
  );
};
