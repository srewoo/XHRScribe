/**
 * Utility functions for robust Chrome extension communication
 */

export interface MessageResponse {
  success: boolean;
  error?: string;
  ready?: boolean;
  [key: string]: any;
}

/**
 * Sends a message to the background script with retry logic
 */
export async function sendMessageWithRetry(
  message: any,
  maxRetries = 3,
  delayMs = 500
): Promise<MessageResponse> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}: Sending message`, message.type);
      
      const response = await chrome.runtime.sendMessage(message);
      
      if (response) {
        console.log(`✅ Message ${message.type} successful:`, response);
        return response;
      } else {
        throw new Error('No response received');
      }
    } catch (error) {
      lastError = error as Error;
      console.warn(`❌ Attempt ${attempt} failed:`, error);
      
      // If it's the last attempt, don't wait
      if (attempt < maxRetries) {
        console.log(`⏳ Waiting ${delayMs}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 1.5; // Exponential backoff
      }
    }
  }
  
  // All attempts failed
  const errorMessage = lastError?.message || 'Unknown error';
  console.error(`❌ All ${maxRetries} attempts failed. Last error:`, errorMessage);
  
  return {
    success: false,
    error: `Connection failed after ${maxRetries} attempts: ${errorMessage}`
  };
}

/**
 * Waits for the background script to be ready
 */
export async function waitForBackgroundReady(
  timeoutMs = 5000,
  pollIntervalMs = 100
): Promise<boolean> {
  const startTime = Date.now();
  let attempts = 0;
  
  while (Date.now() - startTime < timeoutMs) {
    attempts++;
    try {
      // Try a simple PING first
      const response = await chrome.runtime.sendMessage({ type: 'PING' });
      
      if (response && response.success) {
        console.log(`✅ Background script is ready (attempt ${attempts})`);
        return true;
      }
      
      if (attempts % 10 === 0) {
        console.log(`⏳ Background not ready yet, attempt ${attempts}...`);
      }
    } catch (error) {
      if (attempts % 10 === 0) {
        console.log(`⏳ Background script not responding, attempt ${attempts}...`);
      }
    }
    
    // Wait before next check
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  console.error(`❌ Timeout waiting for background script to be ready after ${attempts} attempts`);
  return false;
}

/**
 * Safely sends a message after ensuring background is ready
 */
export async function sendMessageSafely(
  message: any,
  waitTimeout = 3000
): Promise<MessageResponse> {
  // Try sending immediately first (background might already be ready)
  try {
    const directResponse = await chrome.runtime.sendMessage(message);
    if (directResponse && directResponse.success) {
      console.log('✅ Direct message successful:', message.type);
      return directResponse;
    }
  } catch (error) {
    console.log('⏳ Direct message failed, checking background readiness...');
  }
  
  // If direct message fails, wait for background to be ready
  const isReady = await waitForBackgroundReady(waitTimeout);
  
  if (!isReady) {
    // Last attempt with basic retry
    console.log('⚡ Final attempt with basic retry...');
    return sendMessageWithRetry(message, 2, 200);
  }
  
  // Send message with retry logic
  return sendMessageWithRetry(message);
}

/**
 * Checks if the Chrome extension context is valid
 */
export function isExtensionContextValid(): boolean {
  try {
    return !!(chrome?.runtime?.id && !chrome.runtime.lastError);
  } catch (error) {
    return false;
  }
}

/**
 * Gets the current tab ID
 */
export async function getCurrentTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id || null;
  } catch (error) {
    console.error('Failed to get current tab:', error);
    return null;
  }
}
