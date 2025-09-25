export type PersistenceMode = 'IDLE' | 'STANDARD' | 'INTENSIVE';

export class ServiceWorkerManager {
  private static instance: ServiceWorkerManager;
  private mode: PersistenceMode = 'IDLE'; // Default to IDLE
  private alarmName = 'xhrscribe-keepalive';
  private isRecording = false;
  private lastActivity = Date.now();
  private cleanupInterval: number | null = null;

  private constructor() {}

  static getInstance(): ServiceWorkerManager {
    if (!ServiceWorkerManager.instance) {
      ServiceWorkerManager.instance = new ServiceWorkerManager();
    }
    return ServiceWorkerManager.instance;
  }

  async startPersistence(mode: PersistenceMode = 'IDLE'): Promise<void> {
    this.mode = mode;

    // Only start persistence if recording
    if (this.isRecording) {
      switch (mode) {
        case 'INTENSIVE':
          await this.setupIntensivePersistence();
          break;
        case 'STANDARD':
          await this.setupStandardPersistence();
          break;
        case 'IDLE':
          await this.setupIdlePersistence();
          break;
      }
    }

    // Setup cleanup interval
    this.startCleanupInterval();
  }

  async stopPersistence(): Promise<void> {
    // Clear alarms
    await chrome.alarms.clear(this.alarmName);

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.isRecording = false;
  }

  private async setupIntensivePersistence(): Promise<void> {
    // Use alarm-based persistence for active recording
    await this.setupAlarm(0.5); // Every 30 seconds
  }

  private async setupStandardPersistence(): Promise<void> {
    // Balanced persistence
    await this.setupAlarm(1); // Every minute
  }

  private async setupIdlePersistence(): Promise<void> {
    // Minimal persistence - only cleanup
    await chrome.alarms.clear(this.alarmName);
  }

  private async setupAlarm(periodInMinutes: number): Promise<void> {
    try {
      // Clear existing alarm first
      await chrome.alarms.clear(this.alarmName);
      
      // Create new alarm
      await chrome.alarms.create(this.alarmName, {
        periodInMinutes,
        delayInMinutes: 0 // Start immediately
      });

      // Remove any existing listeners to prevent duplicates
      chrome.alarms.onAlarm.removeListener(this.handleAlarm);
      
      // Add new listener
      chrome.alarms.onAlarm.addListener(this.handleAlarm);
    } catch (error) {
      console.error('Failed to setup alarm:', error);
    }
  }

  private handleAlarm = (alarm: chrome.alarms.Alarm): void => {
    if (alarm.name === this.alarmName && this.isRecording) {
      // Only keep alive if actively recording
      this.lastActivity = Date.now();
      chrome.storage.session.set({ keepalive: Date.now() }, () => {
        if (chrome.runtime.lastError) {
          console.error('Keepalive error:', chrome.runtime.lastError);
        }
      });
    } else if (!this.isRecording) {
      // Stop alarms if not recording
      chrome.alarms.clear(this.alarmName);
    }
  };

  async setMode(mode: PersistenceMode): Promise<void> {
    await this.stopPersistence();
    await this.startPersistence(mode);
  }

  getMode(): PersistenceMode {
    return this.mode;
  }

  setRecordingState(isRecording: boolean): void {
    this.isRecording = isRecording;
    this.lastActivity = Date.now();

    if (isRecording) {
      // Switch to STANDARD mode when recording
      this.setMode('STANDARD');
    } else {
      // Switch to IDLE mode when not recording
      this.setMode('IDLE');
    }
  }

  private startCleanupInterval(): void {
    // Clean up old data every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 5 * 60 * 1000) as unknown as number;
  }

  private performCleanup(): void {
    // Remove old temporary data to reduce memory footprint
    const ONE_HOUR = 60 * 60 * 1000;
    const now = Date.now();

    chrome.storage.local.get(null, (items) => {
      const keysToRemove: string[] = [];

      Object.keys(items).forEach(key => {
        // Remove old cache and temporary data
        if (key.startsWith('_cache_') || key.startsWith('_temp_')) {
          const data = items[key];
          if (data && data.timestamp && (now - data.timestamp) > ONE_HOUR) {
            keysToRemove.push(key);
          }
        }
      });

      if (keysToRemove.length > 0) {
        chrome.storage.local.remove(keysToRemove);
      }
    });
  }
}