import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  // When user clicks the extension action icon in the browser toolbar, open Command Center options page
  chrome.action?.onClicked?.addListener(() => {
    chrome.runtime.openOptionsPage();
  });
});
