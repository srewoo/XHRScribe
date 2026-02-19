// Content script for XHRScribe
// Runs on all web pages to support service worker persistence

import { Logger } from '@/services/logging/Logger';

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
          Logger.getInstance().warn('Service worker connection error', { message: chrome.runtime.lastError.message }, 'ContentScript');
          return;
        }
        if (!response) {
          Logger.getInstance().warn('Service worker not responding, may have been suspended', null, 'ContentScript');
        }
      });
    } catch (error) {
      Logger.getInstance().warn('Failed to ping service worker', { error }, 'ContentScript');
    }
  }, 20000); // Every 20 seconds
}

// Send 30-second heartbeats to prevent extension timeout
function startHeartbeat(): void {
  if (heartbeatInterval) return;

  Logger.getInstance().info('Starting heartbeat from content script (30s interval)', null, 'ContentScript');

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
        Logger.getInstance().warn('Heartbeat failed', { message: chrome.runtime.lastError.message }, 'ContentScript');
        // Try to recover by restarting heartbeat
        attemptHeartbeatRecovery();
        return;
      }

      if (response?.status) {
        const status = response.status as HeartbeatStatus;
        if (status.missedBeats > 0) {
          Logger.getInstance().warn(`Service worker missed ${status.missedBeats} heartbeats`, null, 'ContentScript');
        }
      }
    });
  } catch (error) {
    Logger.getInstance().error('Heartbeat send error', error, 'ContentScript');
    attemptHeartbeatRecovery();
  }
}

function attemptHeartbeatRecovery(): void {
  Logger.getInstance().info('Attempting heartbeat recovery', null, 'ContentScript');

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
    Logger.getInstance().debug('Heartbeat stopped', null, 'ContentScript');
  }
}

// Stop pinging
function stopPinging(): void {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

// =============================================
// Floating Panel — injected UI for XHRScribe
// =============================================
class FloatingPanel {
  private container: HTMLDivElement | null = null;
  private minimizedBtn: HTMLDivElement | null = null;
  private isMaximized = false;
  private isRecording = false;
  private isHidden = false; // true when minimized (container hidden but alive)
  private readonly NORMAL_WIDTH = '580px';
  private readonly MAX_WIDTH = '800px';

  toggle(): void {
    if (this.isHidden) {
      // Panel exists but is hidden (minimized) — restore it
      this.restore();
    } else if (this.container) {
      // Panel is visible — close it
      this.close();
    } else {
      // No panel at all — create it
      this.show();
    }
  }

  show(): void {
    if (this.container) return;
    this.removeMinimizedBtn();

    // Container
    const container = document.createElement('div');
    container.id = 'xhrscribe-panel-container';
    Object.assign(container.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      width: this.NORMAL_WIDTH,
      height: '100vh',
      zIndex: '2147483647',
      boxShadow: '-2px 0 12px rgba(0,0,0,0.15)',
      transition: 'width 0.3s ease',
      display: 'flex',
      flexDirection: 'column',
    } as Partial<CSSStyleDeclaration>);

    // iframe loading the React app
    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('popup.html');
    iframe.id = 'xhrscribe-iframe';
    Object.assign(iframe.style, {
      width: '100%',
      height: '100%',
      border: 'none',
      background: '#fff',
    });
    iframe.allow = 'clipboard-write';

    container.appendChild(iframe);
    document.body.appendChild(container);
    this.container = container;
    this.isMaximized = false;
    this.isHidden = false;
  }

  minimize(): void {
    // Hide the container instead of removing it — keeps iframe alive
    if (this.container) {
      this.container.style.display = 'none';
      this.isHidden = true;
    }
    this.showMinimizedBtn();
  }

  maximize(): void {
    if (!this.container) return;
    this.isMaximized = !this.isMaximized;
    this.container.style.width = this.isMaximized ? this.MAX_WIDTH : this.NORMAL_WIDTH;
  }

  close(): void {
    // Actually destroy the container and iframe
    if (this.container) {
      this.container.remove();
      this.container = null;
    }
    this.isHidden = false;
    this.removeMinimizedBtn();
  }

  restore(): void {
    this.removeMinimizedBtn();
    if (this.container && this.isHidden) {
      // Unhide the existing container — iframe state is preserved
      this.container.style.display = 'flex';
      this.isHidden = false;
    } else {
      // No container exists — create fresh
      this.show();
    }
  }

  setRecording(recording: boolean): void {
    this.isRecording = recording;
    // Update minimized button if visible
    if (this.minimizedBtn) {
      const dot = this.minimizedBtn.querySelector('#xhrscribe-rec-dot') as HTMLElement;
      if (recording && !dot) {
        this.minimizedBtn.insertAdjacentHTML('afterbegin', this.recDotHTML());
      } else if (!recording && dot) {
        dot.remove();
      }
    }
  }

  private showMinimizedBtn(): void {
    if (this.minimizedBtn) return;

    const btn = document.createElement('div');
    btn.id = 'xhrscribe-minimized-btn';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '2147483647',
      background: '#0d9488',
      color: '#fff',
      borderRadius: '24px',
      padding: '8px 16px',
      cursor: 'pointer',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      fontWeight: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      transition: 'transform 0.2s ease',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);
    btn.innerHTML = `${this.isRecording ? this.recDotHTML() : ''}<span style="font-size:16px">&lt;&gt;</span> XHRScribe`;

    btn.addEventListener('mouseenter', () => { btn.style.transform = 'scale(1.05)'; });
    btn.addEventListener('mouseleave', () => { btn.style.transform = 'scale(1)'; });
    btn.addEventListener('click', () => this.restore());

    document.body.appendChild(btn);
    this.minimizedBtn = btn;
  }

  private removeMinimizedBtn(): void {
    if (this.minimizedBtn) {
      this.minimizedBtn.remove();
      this.minimizedBtn = null;
    }
  }

  private recDotHTML(): string {
    return `<span id="xhrscribe-rec-dot" style="
      width:10px;height:10px;border-radius:50%;background:#ef4444;display:inline-block;
      animation:xhrscribe-blink 1s infinite;flex-shrink:0;
    "></span>
    <style>@keyframes xhrscribe-blink{0%,100%{opacity:1}50%{opacity:0.2}}</style>`;
  }
}

const floatingPanel = new FloatingPanel();

// Listen for postMessage from iframe (minimize/maximize/close commands)
window.addEventListener('message', (event) => {
  if (!event.data || typeof event.data.type !== 'string') return;
  switch (event.data.type) {
    case 'XHRSCRIBE_MINIMIZE':
      floatingPanel.minimize();
      break;
    case 'XHRSCRIBE_RECORDING':
      floatingPanel.setRecording(!!event.data.recording);
      if (event.data.recording) {
        floatingPanel.minimize();
      }
      break;
    case 'XHRSCRIBE_MAXIMIZE':
      floatingPanel.maximize();
      break;
    case 'XHRSCRIBE_CLOSE':
      floatingPanel.close();
      break;
  }
});

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'TOGGLE_PANEL':
      floatingPanel.toggle();
      sendResponse({ success: true });
      break;

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
      Logger.getInstance().info('Received heartbeat recovery request', null, 'ContentScript');
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
Logger.getInstance().info('XHRScribe content script loaded', null, 'ContentScript');

// Start pinging immediately if on a page being recorded
try {
  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' }, (response) => {
    // Check for chrome.runtime.lastError to prevent unchecked error
    if (chrome.runtime.lastError) {
      Logger.getInstance().warn('Extension not ready', { message: chrome.runtime.lastError.message }, 'ContentScript');
      return;
    }
    if (response?.shouldPing) {
      startPinging();
    }
    // Always start heartbeat to keep extension alive
    if (response?.shouldHeartbeat !== false) {
      startHeartbeat();
    }
    // If recording is active on this tab, show minimized pill with recording indicator
    if (response?.isRecording) {
      floatingPanel.setRecording(true);
      floatingPanel.minimize();
    }
  });
} catch (error) {
  Logger.getInstance().warn('Failed to notify extension of content script ready', { error }, 'ContentScript');
  // Still try to start heartbeat even if initial message failed
  startHeartbeat();
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  stopPinging();
  stopHeartbeat();
});