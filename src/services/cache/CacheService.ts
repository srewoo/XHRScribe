interface CacheEntry {
  data: any;
  timestamp: number;
  expiresAt: number;
}

export class CacheService {
  private static instance: CacheService;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly DEFAULT_TTL = 3600000; // 1 hour in milliseconds

  private constructor() {
    // Clean up expired entries every 5 minutes
    setInterval(() => this.cleanupExpired(), 300000);
  }

  static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  set(key: string, data: any, ttl?: number): void {
    const expiresAt = Date.now() + (ttl || this.DEFAULT_TTL);
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt
    });
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

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
  }

  clear(): void {
    this.cache.clear();
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  // Generate cache key for AI requests
  static generateKey(sessionId: string, options: any): string {
    const optionsString = JSON.stringify(options, Object.keys(options).sort());
    // Use btoa for base64 encoding in browser environment
    const encoded = btoa(optionsString).substring(0, 20);
    return `ai_${sessionId}_${encoded}`;
  }

  // Get cache statistics
  getStats(): { size: number; hits: number; misses: number } {
    return {
      size: this.cache.size,
      hits: 0, // Would need to track this
      misses: 0 // Would need to track this
    };
  }
}