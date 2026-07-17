interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

export class CacheService {
  private static instance: CacheService;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly DEFAULT_TTL = 3600000; // 1 hour in milliseconds
  private hits = 0;
  private misses = 0;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  // Persistence (plan.md 3.4): the in-memory Map is L1; entries are also
  // written to chrome.storage.local (L2) so a cached generation survives the
  // service worker being torn down. Entries larger than this are not persisted
  // to avoid pressuring the shared 10MB storage quota (they stay memory-only).
  private static readonly STORAGE_PREFIX = 'aicache:';
  private static readonly MAX_PERSIST_BYTES = 512 * 1024;
  private hydrated = false;

  private constructor() {
    // Clean up expired entries every 5 minutes. Kept in a field so it can be
    // cleared on dispose() (service workers can be torn down at any time).
    this.cleanupTimer = setInterval(() => this.cleanupExpired(), 300000);
  }

  private storageAvailable(): boolean {
    return typeof chrome !== 'undefined' && !!chrome.storage?.local;
  }

  /**
   * Load persisted entries into memory once per service-worker lifetime. Safe
   * to call repeatedly and in environments without chrome.storage (tests).
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.storageAvailable()) return;
    try {
      const all = await chrome.storage.local.get(null);
      const now = Date.now();
      const expiredKeys: string[] = [];
      for (const [storageKey, value] of Object.entries(all)) {
        if (!storageKey.startsWith(CacheService.STORAGE_PREFIX)) continue;
        const entry = value as CacheEntry;
        const key = storageKey.slice(CacheService.STORAGE_PREFIX.length);
        if (!entry || now > entry.expiresAt) {
          expiredKeys.push(storageKey);
        } else if (!this.cache.has(key)) {
          this.cache.set(key, entry);
        }
      }
      if (expiredKeys.length) await chrome.storage.local.remove(expiredKeys);
    } catch {
      // Best-effort: a hydration failure just means a cold cache.
    }
  }

  private persist(key: string, entry: CacheEntry): void {
    if (!this.storageAvailable()) return;
    try {
      const size = JSON.stringify(entry.data).length;
      if (size > CacheService.MAX_PERSIST_BYTES) return; // too big — memory-only
      void chrome.storage.local.set({ [CacheService.STORAGE_PREFIX + key]: entry });
    } catch {
      // Non-fatal: persistence is an optimization, not a correctness requirement.
    }
  }

  private unpersist(keys: string[]): void {
    if (!this.storageAvailable() || keys.length === 0) return;
    try {
      void chrome.storage.local.remove(keys.map(k => CacheService.STORAGE_PREFIX + k));
    } catch { /* best-effort */ }
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  set(key: string, data: any, ttl?: number): void {
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + (ttl || this.DEFAULT_TTL),
    };
    this.cache.set(key, entry);
    this.persist(key, entry);
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.data;
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.unpersist([key]);
  }

  clear(): void {
    const keys = Array.from(this.cache.keys());
    this.cache.clear();
    this.unpersist(keys);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    const expired: string[] = [];
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        expired.push(key);
      }
    }
    this.unpersist(expired);
  }

  // Generate cache key for AI requests. Uses a stable string hash (not btoa,
  // which throws on non-Latin1 input such as Unicode request bodies).
  static generateKey(sessionId: string, options: any): string {
    const optionsString = JSON.stringify(options, Object.keys(options).sort());
    let hash = 5381;
    for (let i = 0; i < optionsString.length; i++) {
      hash = ((hash << 5) + hash + optionsString.charCodeAt(i)) | 0; // djb2
    }
    return `ai_${sessionId}_${(hash >>> 0).toString(36)}`;
  }

  // Get cache statistics
  getStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
    };
  }
}