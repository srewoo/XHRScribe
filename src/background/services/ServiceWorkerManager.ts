import { Logger } from '@/services/logging/Logger';

export type PersistenceMode = 'IDLE' | 'STANDARD' | 'INTENSIVE' | 'HEARTBEAT';

export interface HeartbeatStatus {
  isAlive: boolean;
  lastHeartbeat: number;
  missedBeats: number;
  mode: PersistenceMode;
}

export class ServiceWorkerManager {
  private static instance: ServiceWorkerManager;
  private mode: PersistenceMode = 'IDLE'; // Default to IDLE
  private alarmName = 'xhrscribe-keepalive';
  private heartbeatAlarmName = 'xhrscribe-heartbeat';
  private isRecording = false;
  private lastActivity = Date.now();
  private lastHeartbeat = Date.now();
  private missedHeartbeats = 0;
  private maxMissedHeartbeats = 3;
  private cleanupInterval: number | null = null;
  private heartbeatInterval: number | null = null;
  private heartbeatCallbacks: Set<(status: HeartbeatStatus) => void> = new Set();

  private constructor() {
    this.setupHeartbeatListener();
  }

  static getInstance(): ServiceWorkerManager {
    if (!ServiceWorkerManager.instance) {
      ServiceWorkerManager.instance = new ServiceWorkerManager();
    }
    return ServiceWorkerManager.instance;
  }

  async startPersistence(mode: PersistenceMode = 'IDLE'): Promise<void> {
    this.mode = mode;

    // Heartbeat mode is always active regardless of recording state
    if (mode === 'HEARTBEAT') {
      await this.setupHeartbeatPersistence();
      this.startCleanupInterval();
      return;
    }

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
    await chrome.alarms.clear(this.heartbeatAlarmName);

    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
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

  // ========== HEARTBEAT SYSTEM ==========

  private setupHeartbeatListener(): void {
    // Listen for heartbeat messages from content scripts and popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'HEARTBEAT_PING') {
        this.receiveHeartbeat();
        sendResponse({
          type: 'HEARTBEAT_PONG',
          status: this.getHeartbeatStatus()
        });
        return true;
      }
      return false;
    });
  }

  private async setupHeartbeatPersistence(): Promise<void> {
    console.log('🫀 Setting up 30-second heartbeat persistence');

    // Clear any existing heartbeat alarm
    await chrome.alarms.clear(this.heartbeatAlarmName);

    // Create heartbeat alarm (0.5 minutes = 30 seconds)
    await chrome.alarms.create(this.heartbeatAlarmName, {
      periodInMinutes: 0.5, // 30 seconds
      delayInMinutes: 0
    });

    // Add heartbeat alarm handler
    chrome.alarms.onAlarm.addListener(this.handleHeartbeatAlarm);

    // Also use interval as backup (more reliable than alarms for short intervals)
    this.startHeartbeatInterval();

    // Store heartbeat state
    await this.saveHeartbeatState();
  }

  private handleHeartbeatAlarm = async (alarm: chrome.alarms.Alarm): Promise<void> => {
    if (alarm.name === this.heartbeatAlarmName) {
      await this.performHeartbeat();
    }
  };

  private startHeartbeatInterval(): void {
    // Clear existing interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Set up 30-second interval as backup to alarms
    this.heartbeatInterval = setInterval(async () => {
      await this.performHeartbeat();
    }, 30000) as unknown as number; // 30 seconds

    console.log('🫀 Heartbeat interval started (30s)');
  }

  private async performHeartbeat(): Promise<void> {
    const now = Date.now();
    const timeSinceLastHeartbeat = now - this.lastHeartbeat;

    // Check if we missed heartbeats (> 45 seconds since last one)
    if (timeSinceLastHeartbeat > 45000) {
      this.missedHeartbeats++;
      console.warn(`💔 Missed heartbeat! Count: ${this.missedHeartbeats}`);

      // Try to recover if too many missed heartbeats
      if (this.missedHeartbeats >= this.maxMissedHeartbeats) {
        console.error('💀 Too many missed heartbeats, attempting recovery...');
        await this.recoverFromHeartbeatFailure();
      }
    } else {
      this.missedHeartbeats = 0;
    }

    this.lastHeartbeat = now;
    this.lastActivity = now;

    // Keep service worker alive by writing to storage
    await chrome.storage.session.set({
      heartbeat: now,
      heartbeatStatus: this.getHeartbeatStatus()
    });

    // Notify all registered callbacks
    this.notifyHeartbeatCallbacks();

    // Log heartbeat (only every 5th beat to reduce noise)
    if (Math.floor(now / 30000) % 5 === 0) {
      console.log('🫀 Heartbeat:', new Date(now).toLocaleTimeString());
    }
  }

  private async recoverFromHeartbeatFailure(): Promise<void> {
    console.log('🔄 Attempting heartbeat recovery...');

    // Reset missed heartbeats counter
    this.missedHeartbeats = 0;

    // Restart heartbeat systems
    await this.setupHeartbeatPersistence();

    // Try to ping all tabs to re-establish connection
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) {
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'HEARTBEAT_RECOVERY',
              timestamp: Date.now()
            });
          } catch (e) {
            // Tab might not have content script, ignore
          }
        }
      }
    } catch (error) {
      console.error('Recovery ping failed:', error);
    }

    console.log('✅ Heartbeat recovery complete');
  }

  receiveHeartbeat(): void {
    this.lastHeartbeat = Date.now();
    this.lastActivity = Date.now();
    this.missedHeartbeats = 0;
  }

  getHeartbeatStatus(): HeartbeatStatus {
    const now = Date.now();
    const timeSinceLastHeartbeat = now - this.lastHeartbeat;

    return {
      isAlive: timeSinceLastHeartbeat < 60000, // Alive if heartbeat within last minute
      lastHeartbeat: this.lastHeartbeat,
      missedBeats: this.missedHeartbeats,
      mode: this.mode
    };
  }

  onHeartbeat(callback: (status: HeartbeatStatus) => void): () => void {
    this.heartbeatCallbacks.add(callback);
    return () => this.heartbeatCallbacks.delete(callback);
  }

  private notifyHeartbeatCallbacks(): void {
    const status = this.getHeartbeatStatus();
    this.heartbeatCallbacks.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        console.error('Heartbeat callback error:', error);
      }
    });
  }

  private async saveHeartbeatState(): Promise<void> {
    await chrome.storage.local.set({
      '_heartbeat_state': {
        mode: this.mode,
        lastHeartbeat: this.lastHeartbeat,
        startedAt: Date.now()
      }
    });
  }

  async enableHeartbeat(): Promise<void> {
    console.log('🫀 Enabling heartbeat mode');
    await this.setMode('HEARTBEAT');
  }

  async disableHeartbeat(): Promise<void> {
    console.log('💤 Disabling heartbeat mode');
    await chrome.alarms.clear(this.heartbeatAlarmName);
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    await this.setMode('IDLE');
  }

  isHeartbeatActive(): boolean {
    return this.mode === 'HEARTBEAT' || this.heartbeatInterval !== null;
  }

  // Keep alive during long-running operations (AI generation, parallel tasks)
  private activeOperationInterval: number | null = null;

  startActiveOperation(): void {
    // More aggressive keepalive during generation (every 10s)
    if (this.activeOperationInterval) {
      clearInterval(this.activeOperationInterval);
    }
    this.activeOperationInterval = setInterval(() => {
      this.lastActivity = Date.now();
      this.lastHeartbeat = Date.now();
      chrome.storage.session.set({ activeOperation: Date.now() }).catch((e: unknown) => Logger.getInstance().warn('Failed to persist active operation', { error: e }, 'ServiceWorkerManager'));
    }, 10000) as unknown as number;
  }

  stopActiveOperation(): void {
    if (this.activeOperationInterval) {
      clearInterval(this.activeOperationInterval);
      this.activeOperationInterval = null;
    }
  }
}