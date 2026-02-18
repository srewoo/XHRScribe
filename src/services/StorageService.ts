import CryptoJS from 'crypto-js';
import { RecordingSession, Settings } from '@/types';

export class StorageService {
  private static instance: StorageService;
  private encryptionKey: string;

  private constructor() {
    // Initialize with a temporary key, will be replaced async
    this.encryptionKey = 'temp-key';
    this.initializeEncryptionKey();
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
    } catch (error) {
      console.error('Failed to initialize encryption key:', error);
      // Fallback to a static key if storage fails
      this.encryptionKey = CryptoJS.SHA256(`${chrome.runtime.id}_fallback`).toString();
    }
  }

  // Encrypt sensitive data
  private encrypt(data: any): string {
    const jsonString = JSON.stringify(data);
    return CryptoJS.AES.encrypt(jsonString, this.encryptionKey).toString();
  }

  // Decrypt sensitive data with multiple fallback strategies
  private decrypt(encryptedData: string): any {
    if (!encryptedData || typeof encryptedData !== 'string') {
      console.warn('Invalid encrypted data');
      return null;
    }

    // Try current key
    const result = this.tryDecrypt(encryptedData, this.encryptionKey);
    if (result !== null) return result;

    // Try without encryption (backward compatibility)
    try {
      const parsed = JSON.parse(encryptedData);
      console.log('Data was not encrypted, returning as-is');
      return parsed;
    } catch {}

    // Data is corrupted
    console.warn('Unable to decrypt data with any method');
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

  // Storage quota threshold (warn at 80%, fail at 95%)
  private static readonly QUOTA_WARN_THRESHOLD = 0.8;
  private static readonly QUOTA_FAIL_THRESHOLD = 0.95;
  private static readonly STORAGE_QUOTA_BYTES = 10 * 1024 * 1024; // 10MB

  // Save recording session with quota check
  async saveSession(session: RecordingSession): Promise<void> {
    // Check storage quota before saving
    const usage = await this.getStorageUsage();
    const usageRatio = usage.used / usage.total;

    if (usageRatio >= StorageService.QUOTA_FAIL_THRESHOLD) {
      // Auto-prune oldest sessions to make room
      const sessions = await this.getSessions();
      if (sessions.length > 5) {
        const pruned = sessions.slice(Math.floor(sessions.length / 2));
        pruned.push(session);
        const encrypted = this.encrypt(pruned);
        await chrome.storage.local.set({ sessions: encrypted });
        console.warn(`Storage at ${Math.round(usageRatio * 100)}% - auto-pruned ${sessions.length - pruned.length + 1} oldest sessions`);
        return;
      }
      throw new Error(`Storage is ${Math.round(usageRatio * 100)}% full. Please delete old sessions to free space.`);
    }

    if (usageRatio >= StorageService.QUOTA_WARN_THRESHOLD) {
      console.warn(`Storage usage at ${Math.round(usageRatio * 100)}% (${(usage.used / 1024 / 1024).toFixed(1)}MB / ${(usage.total / 1024 / 1024).toFixed(0)}MB)`);
    }

    const sessions = await this.getSessions();
    sessions.push(session);

    // Keep only last 50 sessions
    if (sessions.length > 50) {
      sessions.shift();
    }

    // Truncate large response bodies to prevent storage bloat
    const trimmedSessions = sessions.map(s => ({
      ...s,
      requests: s.requests.map(r => ({
        ...r,
        responseBody: typeof r.responseBody === 'string' && r.responseBody.length > 50000
          ? r.responseBody.substring(0, 50000) + '\n... [truncated - response too large]'
          : r.responseBody,
      })),
    }));

    const encrypted = this.encrypt(trimmedSessions);
    await chrome.storage.local.set({ sessions: encrypted });
  }

  // Get all recording sessions
  async getSessions(): Promise<RecordingSession[]> {
    const result = await chrome.storage.local.get('sessions');
    if (result.sessions) {
      const decrypted = this.decrypt(result.sessions);
      return decrypted || [];
    }
    return [];
  }

  // Delete a session
  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);
    const encrypted = this.encrypt(filtered);
    await chrome.storage.local.set({ sessions: encrypted });
  }

  // Rename session
  async renameSession(sessionId: string, newName: string): Promise<void> {
    const sessions = await this.getSessions();
    const updated = sessions.map(s => 
      s.id === sessionId ? { ...s, name: newName } : s
    );
    const encrypted = this.encrypt(updated);
    await chrome.storage.local.set({ sessions: encrypted });
  }

  // Save settings
  async saveSettings(settings: Settings): Promise<void> {
    // Encrypt API keys separately for extra security
    const apiKeys = settings.apiKeys;
    const encryptedKeys = this.encrypt(apiKeys);
    
    // Save settings with encrypted API keys
    const settingsToSave = {
      ...settings,
      apiKeys: undefined // Don't save plain API keys
    };

    await chrome.storage.sync.set({ 
      settings: settingsToSave,
      encryptedApiKeys: encryptedKeys
    });
  }

  // Get settings
  async getSettings(): Promise<Settings | null> {
    try {
      const result = await chrome.storage.sync.get(['settings', 'encryptedApiKeys']);
      
      if (result.settings) {
        const settings = result.settings as Settings;
        
        // Decrypt API keys if they exist
        if (result.encryptedApiKeys) {
          const decryptedKeys = this.decrypt(result.encryptedApiKeys);
          // If decryption failed, reset to empty object rather than failing
          settings.apiKeys = decryptedKeys || {};
          
          // If decryption failed, clear the corrupted data
          if (!decryptedKeys && result.encryptedApiKeys) {
            console.warn('Clearing corrupted API keys, user will need to re-enter them');
            await chrome.storage.sync.remove('encryptedApiKeys');
          }
        } else {
          settings.apiKeys = {};
        }
        
        return settings;
      }
    } catch (error) {
      console.error('Error loading settings:', error);
      // Return default settings on error
      return this.getDefaultSettings();
    }
    
    return null;
  }
  
  // Get default settings
  private getDefaultSettings(): Settings {
    return {
      aiProvider: 'openai',
      aiModel: 'gpt-4.1-mini',
      apiKeys: {},
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
      const testDecrypt = this.decrypt(result.sessions);
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
        const encrypted = this.encrypt(data.sessions);
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