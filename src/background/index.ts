console.log('🎬 XHRScribe background script loading...');

import { BackgroundService } from './services/BackgroundService';
import { ServiceWorkerManager } from './services/ServiceWorkerManager';

// Initialize services
const backgroundService = BackgroundService.getInstance();
const serviceWorkerManager = ServiceWorkerManager.getInstance();

console.log('📦 Services instantiated');

// Initialize background script
async function initializeBackground() {
  try {
    // Keep service worker alive
    await serviceWorkerManager.startPersistence();
    
    // Signal that background is ready
    console.log('✅ XHRScribe background script ready');
    
    // Store ready flag for popup to check
    chrome.storage.session.set({ backgroundReady: true }).catch(() => {
      // Ignore storage errors, not critical
    });
  } catch (error) {
    console.error('❌ Background initialization failed:', error);
  }
}

// Start initialization
initializeBackground();

// Handle extension installation
chrome.runtime.onInstalled.addListener((details) => {
  console.log('XHRScribe installed:', details);
  
  // Set default settings on first install
  if (details.reason === 'install') {
    backgroundService.initializeSettings();
  }
});

// Handle messages from popup and content scripts with proper error handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Background received message:', message?.type, message);
  
  // Wrap in try-catch to prevent uncaught errors
  try {
    // Check if message is valid
    if (!message || !message.type) {
      console.warn('Invalid message received:', message);
      sendResponse({ success: false, error: 'Invalid message format' });
      return false;
    }
    
    // Handle message asynchronously
    backgroundService.handleMessage(message, sender, sendResponse).catch(error => {
      console.error('Error in handleMessage:', error);
      sendResponse({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    });
    
    return true; // Keep message channel open for async responses
  } catch (error) {
    console.error('Error processing message:', error);
    sendResponse({ 
      success: false, 
      error: 'Failed to process message' 
    });
    return false;
  }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && backgroundService.isRecording(tabId)) {
    console.log('Tab updated during recording:', tab.url);
  }
});

// Handle tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  if (backgroundService.isRecording(tabId)) {
    backgroundService.stopRecording(tabId);
  }
});

// Handle debugger events
chrome.debugger.onEvent.addListener((source, method, params) => {
  backgroundService.handleDebuggerEvent(source, method, params);
});

// Handle debugger detach
chrome.debugger.onDetach.addListener((source, reason) => {
  console.log('Debugger detached:', reason);
  if (source.tabId) {
    backgroundService.handleDebuggerDetach(source.tabId);
  }
});

// Export for testing
export { backgroundService, serviceWorkerManager };