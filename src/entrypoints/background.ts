import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  // When user clicks the extension action icon in the browser toolbar, open Command Center options page
  chrome.action?.onClicked?.addListener(() => {
    chrome.runtime.openOptionsPage();
  });

  // When content scripts (e.g. YouTube in-player Cyber Cockpit HUD) request opening options
  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    const msg = message as { action?: string; type?: string } | undefined;
    if (msg?.action === 'OPEN_OPTIONS_PAGE' || msg?.type === 'OPEN_OPTIONS_PAGE') {
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
    }
    return false;
  });
});
