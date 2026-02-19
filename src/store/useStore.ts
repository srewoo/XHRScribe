import { create } from 'zustand';
import { RecordingSession, Settings, GeneratedTest, GenerationOptions, NetworkRequest } from '@/types';
import { Logger } from '@/services/logging/Logger';

interface AppStore {
  // State
  recording: boolean;
  currentSession?: RecordingSession;
  sessions: RecordingSession[];
  selectedSession?: RecordingSession;
  generatedTests: GeneratedTest[];
  settings?: Settings;
  loading: boolean;
  error?: string;

  // Actions
  startRecording: (tabId: number) => Promise<void>;
  stopRecording: (tabId: number) => Promise<void>;
  loadSessions: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteRequests: (sessionId: string, requestIds: string[]) => Promise<void>;
  renameSession: (sessionId: string, newName: string) => Promise<void>;
  selectSession: (session: RecordingSession) => void;
  generateTests: (sessionId: string, options: GenerationOptions) => Promise<GeneratedTest>;
  cancelGeneration: () => Promise<void>;
  loadSettings: () => Promise<void>;
  updateSettings: (settings: Settings) => Promise<void>;
  exportTests: (testId: string, format: string) => Promise<void>;
  importSession: (sessionData: { name?: string; url?: string; requests: NetworkRequest[]; metadata?: Record<string, unknown> }) => Promise<string>;
  clearError: () => void;
  setLoading: (loading: boolean) => void;
}

export const useStore = create<AppStore>((set, get) => ({
  // Initial state
  recording: false,
  sessions: [],
  generatedTests: [],
  loading: false,

  // Start recording
  startRecording: async (tabId: number) => {
    set({ loading: true, error: undefined });
    try {
      // First, ensure background script is ready
      Logger.getInstance().debug('Checking background script readiness', null, 'Store');
      
      let backgroundReady = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const pingResponse = await chrome.runtime.sendMessage({ type: 'PING' });
          if (pingResponse?.success) {
            backgroundReady = true;
            Logger.getInstance().debug('Background script is ready', null, 'Store');
            break;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          Logger.getInstance().warn(`Background readiness check failed (attempt ${attempt}/3)`, { error: errorMessage }, 'Store');
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      }

      if (!backgroundReady) {
        throw new Error('Background script is not responding. Please reload the extension.');
      }

      // Now try to start recording
      Logger.getInstance().info('Starting recording', null, 'Store');
      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId,
      });

      if (response && response.success) {
        Logger.getInstance().info('Recording started successfully', null, 'Store');
        set({
          recording: true,
          currentSession: response.session,
          loading: false,
        });
      } else {
        throw new Error(response?.error || 'Failed to start recording');
      }
    } catch (error) {
      Logger.getInstance().error('Start recording failed', error, 'Store');
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to start recording',
      });
    }
  },

  // Stop recording
  stopRecording: async (tabId: number) => {
    set({ loading: true, error: undefined });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'STOP_RECORDING',
        tabId,
      }).catch((error) => {
        Logger.getInstance().warn('Stop recording message error', { error }, 'Store');
        return { success: false, error: 'Extension not ready. Please refresh and try again.' };
      });

      if (response && response.success) {
        set({
          recording: false,
          currentSession: undefined,
          loading: false,
        });
        // Reload sessions
        await get().loadSessions();
      } else {
        throw new Error(response?.error || 'Failed to stop recording');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to stop recording',
      });
    }
  },

  // Load sessions
  loadSessions: async () => {
    set({ loading: true, error: undefined });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SESSIONS',
      }).catch((error) => {
        Logger.getInstance().warn('Load sessions message error', { error }, 'Store');
        return { success: true, sessions: [] }; // Return empty sessions on error
      });

      if (response && response.success) {
        set({
          sessions: response.sessions || [],
          loading: false,
        });
      } else {
        throw new Error(response.error || 'Failed to load sessions');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load sessions',
      });
    }
  },

  // Rename session
  renameSession: async (sessionId: string, newName: string) => {
    set({ loading: true, error: undefined });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RENAME_SESSION',
        payload: { sessionId, newName },
      });

      if (response && response.success) {
        set((state) => ({
          sessions: state.sessions.map((s) => 
            s.id === sessionId ? { ...s, name: newName } : s
          ),
          selectedSession: 
            state.selectedSession?.id === sessionId 
              ? { ...state.selectedSession, name: newName }
              : state.selectedSession,
          loading: false,
        }));
      } else {
        throw new Error(response?.error || 'Failed to rename session');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to rename session',
      });
    }
  },

  // Delete session
  deleteSession: async (sessionId: string) => {
    set({ loading: true, error: undefined });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_SESSION',
        payload: { sessionId },
      });

      if (response.success) {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== sessionId),
          selectedSession:
            state.selectedSession?.id === sessionId ? undefined : state.selectedSession,
          loading: false,
        }));
      } else {
        throw new Error(response.error || 'Failed to delete session');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to delete session',
      });
    }
  },

  // Delete individual requests from a session
  deleteRequests: async (sessionId: string, requestIds: string[]) => {
    set({ loading: true, error: undefined });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_REQUESTS',
        payload: { sessionId, requestIds },
      });
      if (response.success) {
        const idsToRemove = new Set(requestIds);
        set((state) => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId
              ? { ...s, requests: s.requests.filter(r => !idsToRemove.has(r.id)) }
              : s
          ),
          selectedSession:
            state.selectedSession?.id === sessionId
              ? { ...state.selectedSession, requests: state.selectedSession.requests.filter(r => !idsToRemove.has(r.id)) }
              : state.selectedSession,
          loading: false,
        }));
      } else {
        throw new Error(response.error || 'Failed to delete requests');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to delete requests',
      });
    }
  },

  // Select session
  selectSession: (session: RecordingSession) => {
    set({ selectedSession: session });
  },

  // Generate tests
  generateTests: async (sessionId: string, options: GenerationOptions) => {
    set({ loading: true, error: undefined });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GENERATE_TESTS',
        payload: { sessionId, options },
      });

      if (response.success) {
        set((state) => ({
          generatedTests: [...state.generatedTests, response.test],
          loading: false,
        }));
        // Return the generated test
        return response.test;
      } else {
        throw new Error(response.error || 'Failed to generate tests');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to generate tests',
      });
      throw error;
    }
  },

  // Cancel generation
  cancelGeneration: async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CANCEL_GENERATION' });
    } catch (error) {
      Logger.getInstance().warn('Failed to cancel generation', { error }, 'Store');
    }
  },

  // Load settings
  loadSettings: async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SETTINGS',
      }).catch((error) => {
        Logger.getInstance().warn('Failed to get settings', { error }, 'Store');
        return { success: false };
      });

      if (response && response.success) {
        set({ settings: response.settings });
      } else {
        // Set default settings if failed to load
        set({ 
          settings: {
            aiProvider: 'openai',
            aiModel: 'gpt-4.1-mini',
            apiKeys: {},
            privacyMode: 'cloud',
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
              temperature: 0.7,
              retryAttempts: 3,
              timeout: 30000,
              cacheResponses: true,
            },
          }
        });
      }
    } catch (error) {
      Logger.getInstance().error('Failed to load settings', error, 'Store');
    }
  },

  // Update settings
  updateSettings: async (settings: Settings) => {
    set({ loading: true, error: undefined });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: settings,
      });

      if (response.success) {
        set({
          settings,
          loading: false,
        });
      } else {
        throw new Error(response.error || 'Failed to update settings');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to update settings',
      });
    }
  },

  // Export tests
  exportTests: async (testId: string, format: string) => {
    set({ loading: true, error: undefined });
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_TESTS',
        payload: { testId, format },
      });

      if (response.success) {
        set({ loading: false });
        
        // Handle download or clipboard based on format
        if (format === 'clipboard') {
          await navigator.clipboard.writeText(response.content);
        } else {
          // Trigger download
          const blob = new Blob([response.content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `test-${testId}.${format}`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } else {
        throw new Error(response.error || 'Failed to export tests');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to export tests',
      });
    }
  },

  // Import session from external files
  importSession: async (sessionData: { name?: string; url?: string; requests: NetworkRequest[]; metadata?: Record<string, unknown> }): Promise<string> => {
    set({ loading: true, error: undefined });
    try {
      // Create a unique session ID
      const sessionId = `imported_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

      // Create the session object
      const newSession: RecordingSession = {
        id: sessionId,
        name: sessionData.name || `Imported Session - ${new Date().toLocaleString()}`,
        startTime: Date.now(),
        tabId: -1, // Not applicable for imported sessions
        url: sessionData.url || 'imported',
        status: 'stopped' as const,
        requests: sessionData.requests.map((req: any, index: number) => ({
          id: req.id || `imported_${index}`,
          method: req.method,
          url: req.url,
          type: req.type || 'XHR',
          status: req.status || 200,
          requestHeaders: req.requestHeaders || [],
          responseHeaders: req.responseHeaders || [],
          requestBody: req.requestBody,
          responseBody: req.responseBody,
          timestamp: req.timestamp || Date.now(),
          duration: req.duration || 0,
          folder: req.folder,
          operationId: req.operationId,
          summary: req.summary,
        })),
        metadata: {
          ...sessionData.metadata,
          sessionId,
          createdAt: Date.now(),
          type: 'imported',
          totalRequests: sessionData.requests.length,
          uniqueEndpoints: new Set(sessionData.requests.map((r: any) => `${r.method} ${r.url}`)).size,
          methods: [...new Set(sessionData.requests.map((r: any) => r.method))] as string[],
          domains: [...new Set(sessionData.requests.map((r: any) => {
            try {
              return new URL(r.url).hostname;
            } catch {
              return 'unknown';
            }
          }))] as string[],
        },
      };

      // Store the session via background script
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_SESSION',
        payload: newSession,
      });

      if (response && response.success) {
        // Update local state
        set(state => ({
          sessions: [...state.sessions, newSession],
          selectedSession: newSession,
          loading: false,
        }));

        return sessionId;
      } else {
        throw new Error(response?.error || 'Failed to import session');
      }
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to import session',
      });
      throw error;
    }
  },

  // Clear error
  clearError: () => {
    set({ error: undefined });
  },

  // Set loading
  setLoading: (loading: boolean) => {
    set({ loading });
  },
}));