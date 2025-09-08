// Content script for XHRScribe
// Runs on all web pages to support service worker persistence

let pingInterval: ReturnType<typeof setInterval> | null = null;

// Send periodic pings to keep service worker alive
function startPinging(): void {
  if (pingInterval) return;
  
  pingInterval = setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
        // Check for chrome.runtime.lastError to prevent unchecked error
        if (chrome.runtime.lastError) {
          console.log('Service worker connection error:', chrome.runtime.lastError.message);
          return;
        }
        if (!response) {
          console.log('Service worker not responding, may have been suspended');
        }
      });
    } catch (error) {
      console.log('Failed to ping service worker:', error);
    }
  }, 20000); // Every 20 seconds
}

// Stop pinging
function stopPinging(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'START_PINGING':
      startPinging();
      sendResponse({ success: true });
      break;
      
    case 'STOP_PINGING':
      stopPinging();
      sendResponse({ success: true });
      break;
      
    case 'INJECT_SCRIPT':
      injectScript(message.payload);
      sendResponse({ success: true });
      break;
      
    case 'CAPTURE_CONSOLE':
      captureConsoleOutput();
      sendResponse({ success: true });
      break;
      
    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
  
  return true; // Keep message channel open
});

// Inject a script into the page
function injectScript(code: string): void {
  const script = document.createElement('script');
  script.textContent = code;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// Capture console output (useful for debugging)
function captureConsoleOutput(): void {
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  
  console.log = function(...args: any[]): void {
    try {
      chrome.runtime.sendMessage({
        type: 'CONSOLE_LOG',
        payload: { level: 'log', args: args.map(arg => String(arg)) }
      }, () => {
        // Check for errors but don't block
        if (chrome.runtime.lastError) {
          // Silent fail - extension not ready
        }
      });
    } catch (e) {
      // Silent fail
    }
    originalLog.apply(console, args);
  };
  
  console.error = function(...args: any[]): void {
    try {
      chrome.runtime.sendMessage({
        type: 'CONSOLE_LOG',
        payload: { level: 'error', args: args.map(arg => String(arg)) }
      }, () => {
        if (chrome.runtime.lastError) {
          // Silent fail
        }
      });
    } catch (e) {
      // Silent fail
    }
    originalError.apply(console, args);
  };
  
  console.warn = function(...args: any[]): void {
    try {
      chrome.runtime.sendMessage({
        type: 'CONSOLE_LOG',
        payload: { level: 'warn', args: args.map(arg => String(arg)) }
      }, () => {
        if (chrome.runtime.lastError) {
          // Silent fail
        }
      });
    } catch (e) {
      // Silent fail
    }
    originalWarn.apply(console, args);
  };
}

// Initialize
console.log('XHRScribe content script loaded');

// Start pinging immediately if on a page being recorded
try {
  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }, (response) => {
    // Check for chrome.runtime.lastError to prevent unchecked error
    if (chrome.runtime.lastError) {
      console.log('Extension not ready:', chrome.runtime.lastError.message);
      return;
    }
    if (response?.shouldPing) {
      startPinging();
    }
  });
} catch (error) {
  console.log('Failed to notify extension of content script ready:', error);
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  stopPinging();
});