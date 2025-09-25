import CryptoJS from 'crypto-js';

export class SecureStorageService {
  private static instance: SecureStorageService;
  private readonly SALT = 'XHRScribe_2024_Secure';
  private sessionKey: string | null = null;

  private constructor() {
    this.initializeSessionKey();
  }

  static getInstance(): SecureStorageService {
    if (!SecureStorageService.instance) {
      SecureStorageService.instance = new SecureStorageService();
    }
    return SecureStorageService.instance;
  }

  private async initializeSessionKey() {
    // Generate a unique session key for this session
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    this.sessionKey = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private getEncryptionKey(): string {
    // Combine session key with salt for added security
    return `${this.sessionKey}_${this.SALT}`;
  }

  async saveApiKey(provider: string, apiKey: string): Promise<void> {
    if (!apiKey) {
      throw new Error('API key cannot be empty');
    }

    // Validate API key format
    this.validateApiKey(provider, apiKey);

    // Encrypt the API key
    const encrypted = CryptoJS.AES.encrypt(apiKey, this.getEncryptionKey()).toString();

    // Store in chrome.storage.local with provider-specific key
    return new Promise((resolve, reject) => {
      const storageKey = `apiKey_${provider}_encrypted`;
      chrome.storage.local.set({ [storageKey]: encrypted }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  async getApiKey(provider: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const storageKey = `apiKey_${provider}_encrypted`;
      chrome.storage.local.get([storageKey], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        const encrypted = result[storageKey];
        if (!encrypted) {
          resolve(null);
          return;
        }

        try {
          // Decrypt the API key
          const decrypted = CryptoJS.AES.decrypt(encrypted, this.getEncryptionKey());
          const apiKey = decrypted.toString(CryptoJS.enc.Utf8);

          if (!apiKey) {
            resolve(null);
          } else {
            resolve(apiKey);
          }
        } catch (error) {
          console.error('Failed to decrypt API key:', error);
          resolve(null);
        }
      });
    });
  }

  async removeApiKey(provider: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const storageKey = `apiKey_${provider}_encrypted`;
      chrome.storage.local.remove([storageKey], () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  async getAllApiKeys(): Promise<Record<string, string>> {
    const providers = ['openai', 'anthropic', 'gemini'];
    const apiKeys: Record<string, string> = {};

    for (const provider of providers) {
      const apiKey = await this.getApiKey(provider);
      if (apiKey) {
        apiKeys[provider] = apiKey;
      }
    }

    return apiKeys;
  }

  private validateApiKey(provider: string, apiKey: string): void {
    const patterns: Record<string, RegExp> = {
      openai: /^sk-[a-zA-Z0-9]{48,}$/,
      anthropic: /^sk-ant-[a-zA-Z0-9-]{40,}$/,
      gemini: /^[a-zA-Z0-9_-]{39}$/
    };

    const pattern = patterns[provider];
    if (pattern && !pattern.test(apiKey)) {
      console.warn(`API key format validation failed for ${provider}. Key may be invalid.`);
    }
  }

  // Check if API key exists without decrypting
  async hasApiKey(provider: string): Promise<boolean> {
    return new Promise((resolve) => {
      const storageKey = `apiKey_${provider}_encrypted`;
      chrome.storage.local.get([storageKey], (result) => {
        resolve(!!result[storageKey]);
      });
    });
  }

  // Get masked API key for display (first 7 chars + ...)
  async getMaskedApiKey(provider: string): Promise<string | null> {
    const apiKey = await this.getApiKey(provider);
    if (!apiKey) return null;

    if (apiKey.length > 10) {
      return `${apiKey.substring(0, 7)}...${apiKey.substring(apiKey.length - 4)}`;
    }
    return '***';
  }

  // Clear all stored API keys (for logout/reset)
  async clearAllApiKeys(): Promise<void> {
    const providers = ['openai', 'anthropic', 'gemini'];
    await Promise.all(providers.map(provider => this.removeApiKey(provider)));
  }

  // Validate all stored API keys
  async validateStoredKeys(): Promise<Record<string, boolean>> {
    const providers = ['openai', 'anthropic', 'gemini'];
    const validation: Record<string, boolean> = {};

    for (const provider of providers) {
      const apiKey = await this.getApiKey(provider);
      if (apiKey) {
        try {
          this.validateApiKey(provider, apiKey);
          validation[provider] = true;
        } catch {
          validation[provider] = false;
        }
      } else {
        validation[provider] = false;
      }
    }

    return validation;
  }
}