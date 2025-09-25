type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
  source?: string;
  stack?: string;
}

export class Logger {
  private static instance: Logger;
  private logs: LogEntry[] = [];
  private readonly MAX_LOGS = 1000;
  private logLevel: LogLevel = 'info';
  private enabled = true;

  private constructor() {
    this.loadSettings();
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['logLevel', 'loggingEnabled']);
      if (result.logLevel) {
        this.logLevel = result.logLevel as LogLevel;
      }
      if (typeof result.loggingEnabled === 'boolean') {
        this.enabled = result.loggingEnabled;
      }
    } catch (error) {
      console.error('Failed to load logging settings:', error);
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false;

    const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    return messageLevelIndex >= currentLevelIndex;
  }

  private createLogEntry(level: LogLevel, message: string, data?: any, source?: string): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data ? this.sanitizeData(data) : undefined,
      source,
      stack: level === 'error' ? new Error().stack : undefined
    };
  }

  private sanitizeData(data: any): any {
    // Remove sensitive information
    const sanitized = JSON.parse(JSON.stringify(data, (key, value) => {
      // Remove API keys and tokens
      if (typeof key === 'string' && (
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('password')
      )) {
        return '***REDACTED***';
      }
      return value;
    }));

    return sanitized;
  }

  private addLog(entry: LogEntry) {
    this.logs.push(entry);

    // Trim logs if exceeding max
    if (this.logs.length > this.MAX_LOGS) {
      this.logs = this.logs.slice(-this.MAX_LOGS);
    }

    // Also log to console in development
    const isDevelopment = !chrome.runtime.getManifest().update_url; // Check if unpacked extension
    if (isDevelopment) {
      const consoleMethod = entry.level === 'error' ? 'error' :
                           entry.level === 'warn' ? 'warn' :
                           entry.level === 'debug' ? 'debug' : 'log';

      console[consoleMethod](`[${entry.source || 'XHRScribe'}]`, entry.message, entry.data || '');
    }

    // Persist important logs
    if (entry.level === 'error' || entry.level === 'warn') {
      this.persistLog(entry);
    }
  }

  private async persistLog(entry: LogEntry) {
    try {
      const result = await chrome.storage.local.get(['persistedLogs']);
      const logs = result.persistedLogs || [];
      logs.push(entry);

      // Keep only last 100 persisted logs
      const trimmedLogs = logs.slice(-100);
      await chrome.storage.local.set({ persistedLogs: trimmedLogs });
    } catch (error) {
      console.error('Failed to persist log:', error);
    }
  }

  debug(message: string, data?: any, source?: string) {
    if (this.shouldLog('debug')) {
      const entry = this.createLogEntry('debug', message, data, source);
      this.addLog(entry);
    }
  }

  info(message: string, data?: any, source?: string) {
    if (this.shouldLog('info')) {
      const entry = this.createLogEntry('info', message, data, source);
      this.addLog(entry);
    }
  }

  warn(message: string, data?: any, source?: string) {
    if (this.shouldLog('warn')) {
      const entry = this.createLogEntry('warn', message, data, source);
      this.addLog(entry);
    }
  }

  error(message: string, error?: Error | any, source?: string) {
    if (this.shouldLog('error')) {
      const data = error instanceof Error ? {
        message: error.message,
        stack: error.stack,
        name: error.name
      } : error;

      const entry = this.createLogEntry('error', message, data, source);
      this.addLog(entry);
    }
  }

  // Performance logging
  time(label: string) {
    if (this.shouldLog('debug')) {
      performance.mark(`${label}-start`);
    }
  }

  timeEnd(label: string, source?: string) {
    if (this.shouldLog('debug')) {
      performance.mark(`${label}-end`);
      try {
        performance.measure(label, `${label}-start`, `${label}-end`);
        const measure = performance.getEntriesByName(label)[0];
        this.debug(`Performance: ${label}`, { duration: `${measure.duration.toFixed(2)}ms` }, source);

        // Cleanup
        performance.clearMarks(`${label}-start`);
        performance.clearMarks(`${label}-end`);
        performance.clearMeasures(label);
      } catch (error) {
        this.warn(`Failed to measure performance for ${label}`, error);
      }
    }
  }

  // Get logs for debugging
  getLogs(level?: LogLevel): LogEntry[] {
    if (!level) return this.logs;
    return this.logs.filter(log => log.level === level);
  }

  // Clear logs
  clearLogs() {
    this.logs = [];
  }

  // Export logs for debugging
  async exportLogs(): Promise<string> {
    const allLogs = await this.getAllLogs();
    return JSON.stringify(allLogs, null, 2);
  }

  private async getAllLogs(): Promise<LogEntry[]> {
    try {
      const result = await chrome.storage.local.get(['persistedLogs']);
      const persistedLogs = result.persistedLogs || [];
      return [...persistedLogs, ...this.logs];
    } catch (error) {
      console.error('Failed to get all logs:', error);
      return this.logs;
    }
  }

  // Configure logging
  setLogLevel(level: LogLevel) {
    this.logLevel = level;
    chrome.storage.local.set({ logLevel: level });
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    chrome.storage.local.set({ loggingEnabled: enabled });
  }

  // Group logging for related operations
  group(label: string) {
    const isDevelopment = !chrome.runtime.getManifest().update_url;
    if (isDevelopment && this.enabled) {
      console.group(label);
    }
  }

  groupEnd() {
    const isDevelopment = !chrome.runtime.getManifest().update_url;
    if (isDevelopment && this.enabled) {
      console.groupEnd();
    }
  }
}

// Export singleton instance for convenience
export const logger = Logger.getInstance();