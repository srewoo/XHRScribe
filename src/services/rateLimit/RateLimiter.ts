interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface RequestRecord {
  timestamp: number;
  count: number;
}

export class RateLimiter {
  private static instance: RateLimiter;
  private requests: Map<string, RequestRecord[]> = new Map();

  private readonly limits: Record<string, RateLimitConfig> = {
    'openai': { maxRequests: 60, windowMs: 60000 }, // 60 requests per minute
    'anthropic': { maxRequests: 50, windowMs: 60000 }, // 50 requests per minute
    'gemini': { maxRequests: 60, windowMs: 60000 }, // 60 requests per minute
    'local': { maxRequests: 100, windowMs: 60000 }, // 100 requests per minute
    'default': { maxRequests: 30, windowMs: 60000 } // 30 requests per minute
  };

  private constructor() {}

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  async checkLimit(provider: string): Promise<boolean> {
    const config = this.limits[provider] || this.limits.default;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get or initialize request records for this provider
    if (!this.requests.has(provider)) {
      this.requests.set(provider, []);
    }

    const records = this.requests.get(provider)!;

    // Remove old records outside the window
    const validRecords = records.filter(r => r.timestamp > windowStart);

    // Count requests in the current window
    const requestCount = validRecords.reduce((sum, r) => sum + r.count, 0);

    if (requestCount >= config.maxRequests) {
      return false; // Rate limit exceeded
    }

    // Add new request
    validRecords.push({ timestamp: now, count: 1 });
    this.requests.set(provider, validRecords);

    return true;
  }

  async waitForSlot(provider: string): Promise<void> {
    const config = this.limits[provider] || this.limits.default;

    while (!(await this.checkLimit(provider))) {
      // Calculate wait time
      const records = this.requests.get(provider) || [];
      if (records.length > 0) {
        const oldestRecord = records[0];
        const waitTime = oldestRecord.timestamp + config.windowMs - Date.now();

        if (waitTime > 0) {
          await new Promise(resolve => setTimeout(resolve, Math.min(waitTime, 5000)));
        }
      } else {
        // Default wait
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  getRemainingRequests(provider: string): number {
    const config = this.limits[provider] || this.limits.default;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    const records = this.requests.get(provider) || [];
    const validRecords = records.filter(r => r.timestamp > windowStart);
    const requestCount = validRecords.reduce((sum, r) => sum + r.count, 0);

    return Math.max(0, config.maxRequests - requestCount);
  }

  getResetTime(provider: string): number {
    const config = this.limits[provider] || this.limits.default;
    const records = this.requests.get(provider) || [];

    if (records.length === 0) {
      return 0;
    }

    const oldestRecord = records[0];
    return Math.max(0, oldestRecord.timestamp + config.windowMs - Date.now());
  }

  reset(provider?: string): void {
    if (provider) {
      this.requests.delete(provider);
    } else {
      this.requests.clear();
    }
  }
}