import CryptoJS from 'crypto-js';
import { RecordingSession, Settings } from '@/types';

export class StorageService {
  private static instance: StorageService;
  private encryptionKey: string;
  private keyInitialized: boolean = false;
  private keyInitPromise: Promise<void>;

  private constructor() {
    // Initialize with a temporary key, will be replaced async
    this.encryptionKey = 'temp-key';
    this.keyInitPromise = this.initializeEncryptionKey();
  }

  static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  private async initializeEncryptionKey(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('persistentEncryptionKey');
      if (result.persistentEncryptionKey) {
        this.encryptionKey = result.persistentEncryptionKey;
      } else {
        // Generate a new persistent key for this installation
        const newKey = CryptoJS.lib.WordArray.random(256/8).toString();
        this.encryptionKey = newKey;
        await chrome.storage.local.set({ persistentEncryptionKey: newKey });
      }
      this.keyInitialized = true;
      console.log('Encryption key initialized successfully');
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      // Fallback to a static key if storage fails
      this.encryptionKey = CryptoJS.SHA256(`${chrome.runtime.id}_fallback`).toString();
      this.keyInitialized = true;
    }
  }

  // Encrypt sensitive data
  private async encrypt(data: any): Promise<string> {
    await this.keyInitPromise; // Ensure key is initialized
    const jsonString = JSON.stringify(data);
    return CryptoJS.AES.encrypt(jsonString, this.encryptionKey).toString();
  }

  // Decrypt sensitive data with multiple fallback strategies
  private async decrypt(encryptedData: string): Promise<any> {
    await this.keyInitPromise; // Ensure key is initialized
    if (!encryptedData || typeof encryptedData !== 'string') {
      console.warn('Invalid encrypted data');
      return null;
    }

    // Try current key
    const result = this.tryDecrypt(encryptedData, this.encryptionKey);
    if (result !== null) return result;

    // Try with fallback key (in case key changed)
    const fallbackKey = CryptoJS.SHA256(`${chrome.runtime.id}_fallback`).toString();
    const fallbackResult = this.tryDecrypt(encryptedData, fallbackKey);
    if (fallbackResult !== null) {
      console.log('Successfully decrypted with fallback key');
      return fallbackResult;
    }

    // Try without encryption (backward compatibility)
    try {
      const parsed = JSON.parse(encryptedData);
      console.log('Data was not encrypted, returning as-is');
      return parsed;
    } catch {}

    // Try base64 decode (in case it was just encoded)
    try {
      const decoded = atob(encryptedData);
      const parsed = JSON.parse(decoded);
      console.log('Data was base64 encoded, decoded successfully');
      return parsed;
    } catch {}

    // Data is corrupted - log but don't throw
    console.warn('Unable to decrypt data with any method, returning null');
    return null;
  }

  private tryDecrypt(encryptedData: string, key: string): any {
    try {
      const decrypted = CryptoJS.AES.decrypt(encryptedData, key);
      const jsonString = decrypted.toString(CryptoJS.enc.Utf8);
      
      if (!jsonString) {
        return null;
      }
      
      return JSON.parse(jsonString);
    } catch (error) {
      return null;
    }
  }

  // Save recording session
  async saveSession(session: RecordingSession): Promise<void> {
    const sessions = await this.getSessions();
    sessions.push(session);

    // Keep only last 50 sessions
    if (sessions.length > 50) {
      sessions.shift();
    }

    const encrypted = await this.encrypt(sessions);
    await chrome.storage.local.set({ sessions: encrypted });
  }

  // Get all recording sessions
  async getSessions(): Promise<RecordingSession[]> {
    const result = await chrome.storage.local.get('sessions');
    if (result.sessions) {
      const decrypted = await this.decrypt(result.sessions);
      return decrypted || [];
    }
    return [];
  }

  // Delete a session
  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);
    const encrypted = await this.encrypt(filtered);
    await chrome.storage.local.set({ sessions: encrypted });
  }

  // Rename session
  async renameSession(sessionId: string, newName: string): Promise<void> {
    const sessions = await this.getSessions();
    const updated = sessions.map(s => 
      s.id === sessionId ? { ...s, name: newName } : s
    );
    const encrypted = await this.encrypt(updated);
    await chrome.storage.local.set({ sessions: encrypted });
  }

  // Save settings
  async saveSettings(settings: Settings): Promise<void> {
    // Encrypt API keys separately for extra security
    const apiKeys = settings.apiKeys;
    const encryptedKeys = await this.encrypt(apiKeys);

    // Save settings with encrypted API keys
    const settingsToSave = {
      ...settings,
      apiKeys: undefined // Don't save plain API keys
    };

    await chrome.storage.sync.set({
      settings: settingsToSave,
      encryptedApiKeys: encryptedKeys
    });
    console.log('Settings saved successfully with encrypted API keys');
  }

  // Get settings with enhanced error recovery
  async getSettings(): Promise<Settings | null> {
    try {
      const result = await chrome.storage.sync.get(['settings', 'encryptedApiKeys']);

      if (result.settings) {
        let settings = result.settings as Settings;

        // Validate settings structure
        if (!this.isValidSettingsObject(settings)) {
          console.warn('Invalid settings structure detected, using defaults');
          settings = this.getDefaultSettings();
        }

        // Handle API keys with enhanced error recovery
        if (result.encryptedApiKeys) {
          try {
            const decryptedKeys = await this.decrypt(result.encryptedApiKeys);

            if (decryptedKeys && typeof decryptedKeys === 'object') {
              settings.apiKeys = { ...settings.apiKeys, ...decryptedKeys };
              console.log('API keys successfully decrypted');
            } else {
              console.warn('API key decryption returned invalid data, using empty keys');
              settings.apiKeys = settings.apiKeys || {};

              // Clear corrupted data after a delay to avoid infinite loops
              setTimeout(async () => {
                try {
                  await chrome.storage.sync.remove('encryptedApiKeys');
                  console.log('Corrupted API keys cleared from storage');
                } catch (error) {
                  console.error('Failed to clear corrupted API keys:', error);
                }
              }, 1000);
            }
          } catch (decryptError) {
            console.error('Error during API key decryption:', decryptError);
            settings.apiKeys = settings.apiKeys || {};
          }
        } else {
          settings.apiKeys = settings.apiKeys || {};
        }

        return settings;
      } else {
        console.log('No settings found, returning defaults');
        return this.getDefaultSettings();
      }
    } catch (error) {
      console.error('Error loading settings:', error);

      // Try to recover by clearing potentially corrupted data
      try {
        await this.clearCorruptedData();
      } catch (clearError) {
        console.error('Failed to clear corrupted data:', clearError);
      }

      return this.getDefaultSettings();
    }
  }

  // Validate settings object structure
  private isValidSettingsObject(settings: any): boolean {
    if (!settings || typeof settings !== 'object') {
      return false;
    }

    // Check for required properties
    const requiredProps = ['aiProvider', 'testFramework', 'privacyMode'];
    for (const prop of requiredProps) {
      if (!(prop in settings)) {
        return false;
      }
    }

    return true;
  }

  // Clear potentially corrupted data
  private async clearCorruptedData(): Promise<void> {
    try {
      console.log('Attempting to clear corrupted storage data...');

      // Remove potentially corrupted items
      await chrome.storage.sync.remove(['encryptedApiKeys']);
      await chrome.storage.local.remove(['persistentEncryptionKey']);

      // Reinitialize encryption key
      await this.initializeEncryptionKey();

      console.log('Corrupted data cleared, storage reset');
    } catch (error) {
      console.error('Failed to clear corrupted data:', error);
    }
  }

  // Reset all settings to defaults (public method for user-initiated reset)
  async resetSettings(): Promise<void> {
    try {
      console.log('Resetting all settings to defaults...');

      // Clear all storage
      await chrome.storage.sync.clear();
      await chrome.storage.local.clear();

      // Reinitialize encryption key
      await this.initializeEncryptionKey();

      // Save default settings
      const defaultSettings = this.getDefaultSettings();
      await chrome.storage.sync.set({ settings: defaultSettings });

      console.log('Settings reset completed successfully');
    } catch (error) {
      console.error('Failed to reset settings:', error);
      throw error;
    }
  }

  // Get default settings
  private getDefaultSettings(): Settings {
    return {
      aiProvider: 'openai',
      aiModel: 'gpt-4o-mini',
      apiKeys: {},
      testFramework: 'jest',
      privacyMode: 'cloud',
      authGuide: undefined, // Custom auth instructions (optional)
      dataMasking: {
        enabled: true,
        maskPII: true,
        maskTokens: true,
        maskEmails: true,
        customPatterns: [],
      },
      filtering: {
        includeDomains: [],
        excludeDomains: [],
        includeTypes: ['XHR', 'Fetch', 'GraphQL'],
        minDuration: 0,
        maxRequestSize: 10485760,
      },
      advanced: {
        maxTokens: 4000,
        temperature: 0.7,
        retryAttempts: 3,
        timeout: 30000,
        cacheResponses: true,
      },
    };
  }

  // Clear all data
  async clearAllData(): Promise<void> {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
  }

  // Reset corrupted encrypted data only
  async resetCorruptedData(): Promise<void> {
    console.warn('Resetting corrupted encrypted data...');
    
    // Remove encrypted API keys but keep other settings
    await chrome.storage.sync.remove('encryptedApiKeys');
    
    // Clear sessions if they're corrupted
    const result = await chrome.storage.local.get('sessions');
    if (result.sessions && typeof result.sessions === 'string') {
      const testDecrypt = await this.decrypt(result.sessions);
      if (!testDecrypt) {
        console.warn('Sessions data is corrupted, clearing...');
        await chrome.storage.local.remove('sessions');
      }
    }
    
    // Generate new encryption key for future data
    const newKey = CryptoJS.lib.WordArray.random(256/8).toString();
    this.encryptionKey = newKey;
    await chrome.storage.local.set({ persistentEncryptionKey: newKey });
    
    console.log('Corrupted data reset complete');
  }

  // Export data (for backup)
  async exportData(): Promise<string> {
    const sessions = await this.getSessions();
    const settings = await this.getSettings();
    
    const exportData = {
      version: '1.0.0',
      exportDate: new Date().toISOString(),
      sessions,
      settings: {
        ...settings,
        apiKeys: {} // Don't export API keys
      }
    };

    return JSON.stringify(exportData, null, 2);
  }

  // Import data
  async importData(jsonData: string): Promise<void> {
    try {
      const data = JSON.parse(jsonData);
      
      if (data.sessions) {
        const encrypted = await this.encrypt(data.sessions);
        await chrome.storage.local.set({ sessions: encrypted });
      }
      
      if (data.settings) {
        // Don't import API keys for security
        delete data.settings.apiKeys;
        await chrome.storage.sync.set({ settings: data.settings });
      }
    } catch (error) {
      throw new Error('Invalid import data format');
    }
  }

  // Get storage usage
  async getStorageUsage(): Promise<{ used: number; total: number }> {
    return new Promise((resolve) => {
      chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
        // Chrome local storage quota is typically 10MB
        const total = 10 * 1024 * 1024; // 10MB in bytes
        resolve({
          used: bytesInUse,
          total
        });
      });
    });
  }

  // Chunked storage for large data
  async saveLargeData(key: string, data: any): Promise<void> {
    const jsonString = JSON.stringify(data);
    const chunkSize = 8000; // Chrome storage value size limit is ~8KB
    const chunks: string[] = [];

    for (let i = 0; i < jsonString.length; i += chunkSize) {
      chunks.push(jsonString.substr(i, chunkSize));
    }

    // Save chunks
    const chunkData: Record<string, any> = {
      [`${key}_count`]: chunks.length
    };

    chunks.forEach((chunk, index) => {
      chunkData[`${key}_${index}`] = chunk;
    });

    await chrome.storage.local.set(chunkData);
  }

  async getLargeData(key: string): Promise<any> {
    const countResult = await chrome.storage.local.get(`${key}_count`);
    const count = countResult[`${key}_count`];

    if (!count) return null;

    const chunkKeys = Array.from({ length: count }, (_, i) => `${key}_${i}`);
    const chunksResult = await chrome.storage.local.get(chunkKeys);

    const chunks = chunkKeys.map(k => chunksResult[k] || '');
    const jsonString = chunks.join('');

    try {
      return JSON.parse(jsonString);
    } catch (error) {
      console.error('Failed to parse large data:', error);
      return null;
    }
  }
}