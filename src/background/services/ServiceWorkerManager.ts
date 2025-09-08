export type PersistenceMode = 'IDLE' | 'STANDARD' | 'INTENSIVE';

export class ServiceWorkerManager {
  private static instance: ServiceWorkerManager;
  private mode: PersistenceMode = 'STANDARD';
  private alarmName = 'xhrscribe-keepalive';
  private port: chrome.runtime.Port | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private pingInterval: number | null = null;

  private constructor() {}

  static getInstance(): ServiceWorkerManager {
    if (!ServiceWorkerManager.instance) {
      ServiceWorkerManager.instance = new ServiceWorkerManager();
    }
    return ServiceWorkerManager.instance;
  }

  async startPersistence(mode: PersistenceMode = 'STANDARD'): Promise<void> {
    this.mode = mode;
    
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

  async stopPersistence(): Promise<void> {
    // Clear alarms
    await chrome.alarms.clear(this.alarmName);
    
    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Close port connection
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (e) {
        // Port might already be disconnected
      }
      this.port = null;
    }

    // Reset reconnect attempts
    this.reconnectAttempts = 0;
  }

  private async setupIntensivePersistence(): Promise<void> {
    // Use alarm-based persistence only for intensive mode
    await this.setupAlarm(0.5); // Every 30 seconds
  }

  private async setupStandardPersistence(): Promise<void> {
    // Use balanced persistence with just alarms
    await this.setupAlarm(1); // Every minute
  }

  private async setupIdlePersistence(): Promise<void> {
    // Minimal persistence for idle periods
    await this.setupAlarm(2); // Every 2 minutes
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
    if (alarm.name === this.alarmName) {
      // Simple keepalive action - just access storage
      chrome.storage.local.get('keepalive', () => {
        if (chrome.runtime.lastError) {
          console.error('Keepalive storage access error:', chrome.runtime.lastError);
        }
      });
    }
  };

  async setMode(mode: PersistenceMode): Promise<void> {
    await this.stopPersistence();
    await this.startPersistence(mode);
  }

  getMode(): PersistenceMode {
    return this.mode;
  }
}