import { NetworkRequest, RecordingSession, ReplayConfig, ReplayResult, ReplaySessionResult } from '@/types';

export class TrafficReplayService {
  private static instance: TrafficReplayService;
  private abortController: AbortController | null = null;

  private constructor() {}

  static getInstance(): TrafficReplayService {
    if (!TrafficReplayService.instance) {
      TrafficReplayService.instance = new TrafficReplayService();
    }
    return TrafficReplayService.instance;
  }

  async replayRequest(request: NetworkRequest, config: ReplayConfig): Promise<ReplayResult> {
    const url = this.buildReplayUrl(request.url, config.baseUrl);
    const headers = config.includeHeaders ? this.filterHeaders(request.requestHeaders || {}) : {};

    const startTime = performance.now();
    try {
      const fetchOptions: RequestInit = {
        method: request.method,
        headers,
        signal: this.abortController?.signal,
      };

      // Add body for non-GET/HEAD methods
      if (request.requestBody && !['GET', 'HEAD'].includes(request.method)) {
        fetchOptions.body = typeof request.requestBody === 'string'
          ? request.requestBody
          : JSON.stringify(request.requestBody);
      }

      const response = await fetch(url, fetchOptions);
      const replayDuration = Math.round(performance.now() - startTime);

      // Compare response bodies
      let bodyDiff: ReplayResult['bodyDiff'];
      try {
        const replayBody = await response.clone().json();
        const originalBody = typeof request.responseBody === 'string'
          ? JSON.parse(request.responseBody)
          : request.responseBody;
        if (originalBody && replayBody) {
          bodyDiff = this.compareResponses(originalBody, replayBody);
        }
      } catch {
        // Non-JSON response or parse error — skip diff
      }

      return {
        requestUrl: url,
        method: request.method,
        originalStatus: request.status || 0,
        replayStatus: response.status,
        originalDuration: request.duration || 0,
        replayDuration,
        matched: request.status === response.status,
        bodyDiff,
      };
    } catch (error) {
      const replayDuration = Math.round(performance.now() - startTime);
      return {
        requestUrl: url,
        method: request.method,
        originalStatus: request.status || 0,
        replayStatus: 0,
        originalDuration: request.duration || 0,
        replayDuration,
        matched: false,
        error: error instanceof Error ? error.message : 'Request failed',
      };
    }
  }

  async replaySession(
    session: RecordingSession,
    config: ReplayConfig,
    onProgress: (current: number, total: number, result: ReplayResult) => void
  ): Promise<ReplaySessionResult> {
    this.abortController = new AbortController();

    const requests = session.requests.filter(req => {
      // Skip WebSocket and streaming
      if (req.type === 'WebSocket') return false;
      // Skip patterns
      for (const pattern of config.skipPatterns) {
        if (pattern && req.url.includes(pattern)) return false;
      }
      return true;
    });

    const results: ReplayResult[] = [];

    for (let i = 0; i < requests.length; i++) {
      if (this.abortController.signal.aborted) break;

      const result = await this.replayRequest(requests[i], config);
      results.push(result);
      onProgress(i + 1, requests.length, result);

      // Delay between requests
      if (config.delayMs > 0 && i < requests.length - 1) {
        await new Promise(resolve => setTimeout(resolve, config.delayMs));
      }
    }

    const passed = results.filter(r => r.matched).length;
    const errors = results.filter(r => r.error).length;
    const failed = results.length - passed - errors;

    const durations = results.filter(r => !r.error);
    const avgOriginalDuration = durations.length > 0
      ? Math.round(durations.reduce((s, r) => s + r.originalDuration, 0) / durations.length)
      : 0;
    const avgReplayDuration = durations.length > 0
      ? Math.round(durations.reduce((s, r) => s + r.replayDuration, 0) / durations.length)
      : 0;

    this.abortController = null;

    return { results, passed, failed, errors, avgOriginalDuration, avgReplayDuration };
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private buildReplayUrl(originalUrl: string, baseUrl?: string): string {
    if (!baseUrl) return originalUrl;
    try {
      const parsed = new URL(originalUrl);
      const base = new URL(baseUrl);
      parsed.protocol = base.protocol;
      parsed.host = base.host;
      return parsed.toString();
    } catch {
      return originalUrl;
    }
  }

  private compareResponses(original: any, replay: any): ReplayResult['bodyDiff'] {
    const originalKeys = new Set(Object.keys(original || {}));
    const replayKeys = new Set(Object.keys(replay || {}));

    const addedKeys: string[] = [];
    const removedKeys: string[] = [];
    const changedKeys: string[] = [];

    for (const key of replayKeys) {
      if (!originalKeys.has(key)) addedKeys.push(key);
    }
    for (const key of originalKeys) {
      if (!replayKeys.has(key)) removedKeys.push(key);
      else if (JSON.stringify(original[key]) !== JSON.stringify(replay[key])) changedKeys.push(key);
    }

    return {
      matched: addedKeys.length === 0 && removedKeys.length === 0 && changedKeys.length === 0,
      addedKeys,
      removedKeys,
      changedKeys,
    };
  }

  private filterHeaders(headers: Record<string, string>): Record<string, string> {
    const skipHeaders = new Set([
      'host', 'origin', 'referer', 'cookie', 'set-cookie',
      'connection', 'upgrade', 'sec-websocket-key', 'sec-websocket-version',
      'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site',
      'content-length', // Will be recalculated by fetch
    ]);

    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (!skipHeaders.has(key.toLowerCase())) {
        filtered[key] = value;
      }
    }
    return filtered;
  }
}
