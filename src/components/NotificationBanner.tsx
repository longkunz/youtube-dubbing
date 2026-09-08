import React from 'react';
import { AlertTriangle, Settings, X } from 'lucide-react';

export interface NotificationBannerProps {
  /** Optional custom message text. Defaults to caption fallback guide. */
  message?: string;
  /** Optional callback when user clicks "Configure Settings". */
  onConfigureSettings?: () => void;
  /** Optional callback when user dismisses the notification. */
  onDismiss?: () => void;
  /** Additional custom CSS class names. */
  className?: string;
}

const DEFAULT_BANNER_MESSAGE =
  'No captions found for this video. Add a Groq/OpenAI API key in Settings to activate Whisper STT.';

/**
 * Cyberpunk Notification Banner displayed in-player when captions are unavailable,
 * prompting the user to configure Whisper STT credentials in the Command Center.
 */
export const NotificationBanner: React.FC<NotificationBannerProps> = ({
  message = DEFAULT_BANNER_MESSAGE,
  onConfigureSettings,
  onDismiss,
  className = '',
}) => {
  const handleConfigure = () => {
    if (onConfigureSettings) {
      onConfigureSettings();
    } else if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  };

  return (
    <div
      role="alert"
      className={`notification-banner flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-[#ffb703]/40 bg-[#05070e]/90 text-white backdrop-blur-xl shadow-[0_0_20px_rgba(255,183,3,0.2)] font-mono text-xs transition-all ${className}`}
      style={{
        borderLeft: '4px solid #ffb703',
      }}
    >
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <AlertTriangle className="w-4 h-4 text-[#ffb703] flex-shrink-0 animate-pulse" />
        <span className="text-gray-200 leading-relaxed font-sans text-xs">
          {message}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={handleConfigure}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#ffb703]/20 hover:bg-[#ffb703]/30 text-[#ffb703] border border-[#ffb703]/50 hover:border-[#ffb703] text-[11px] font-mono uppercase tracking-wider transition-colors duration-150 cursor-pointer"
        >
          <Settings className="w-3 h-3" />
          Configure Settings
        </button>

        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={onDismiss}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors duration-150 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};