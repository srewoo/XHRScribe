// Content script for XHRScribe
// Runs on all web pages to support service worker persistence

let pingInterval: ReturnType<typeof setInterval> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

interface HeartbeatStatus {
  isAlive: boolean;
  lastHeartbeat: number;
  missedBeats: number;
  mode: string;
}

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

// Send 30-second heartbeats to prevent extension timeout
function startHeartbeat(): void {
  if (heartbeatInterval) return;

  console.log('🫀 Starting heartbeat from content script (30s interval)');

  // Send initial heartbeat
  sendHeartbeat();

  // Set up 30-second interval
  heartbeatInterval = setInterval(() => {
    sendHeartbeat();
  }, 30000); // Every 30 seconds
}

function sendHeartbeat(): void {
  try {
    chrome.runtime.sendMessage({
      type: 'HEARTBEAT_PING',
      timestamp: Date.now(),
      source: 'content_script'
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('💔 Heartbeat failed:', chrome.runtime.lastError.message);
        // Try to recover by restarting heartbeat
        attemptHeartbeatRecovery();
        return;
      }

      if (response?.status) {
        const status = response.status as HeartbeatStatus;
        if (status.missedBeats > 0) {
          console.warn(`⚠️ Service worker missed ${status.missedBeats} heartbeats`);
        }
      }
    });
  } catch (error) {
    console.error('Heartbeat send error:', error);
    attemptHeartbeatRecovery();
  }
}

function attemptHeartbeatRecovery(): void {
  console.log('🔄 Attempting heartbeat recovery...');

  // Stop current heartbeat
  stopHeartbeat();

  // Wait a moment then restart
  setTimeout(() => {
    startHeartbeat();
  }, 2000);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log('💤 Heartbeat stopped');
  }
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

    case 'START_HEARTBEAT':
      startHeartbeat();
      sendResponse({ success: true });
      break;

    case 'STOP_HEARTBEAT':
      stopHeartbeat();
      sendResponse({ success: true });
      break;

    case 'HEARTBEAT_RECOVERY':
      // Service worker is requesting recovery - restart heartbeat
      console.log('🔄 Received heartbeat recovery request');
      stopHeartbeat();
      startHeartbeat();
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
    // Always start heartbeat to keep extension alive
    if (response?.shouldHeartbeat !== false) {
      startHeartbeat();
    }
  });
} catch (error) {
  console.log('Failed to notify extension of content script ready:', error);
  // Still try to start heartbeat even if initial message failed
  startHeartbeat();
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  stopPinging();
  stopHeartbeat();
});