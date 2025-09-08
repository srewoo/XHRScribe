import { create } from 'zustand';
import { RecordingSession, Settings, GeneratedTest, NetworkRequest } from '@/types';

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
  renameSession: (sessionId: string, newName: string) => Promise<void>;
  selectSession: (session: RecordingSession) => void;
  generateTests: (sessionId: string, options: any) => Promise<any>;
  loadSettings: () => Promise<void>;
  updateSettings: (settings: Settings) => Promise<void>;
  exportTests: (testId: string, format: string) => Promise<void>;
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
      const response = await chrome.runtime.sendMessage({
        type: 'START_RECORDING',
        tabId,
      }).catch((error) => {
        console.log('Message error:', error);
        // Return a failure response if messaging fails
        return { success: false, error: 'Extension not ready. Please refresh and try again.' };
      });

      if (response && response.success) {
        set({
          recording: true,
          currentSession: response.session,
          loading: false,
        });
      } else {
        throw new Error(response?.error || 'Failed to start recording');
      }
    } catch (error) {
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
        console.log('Message error:', error);
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
        console.log('Message error:', error);
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

  // Select session
  selectSession: (session: RecordingSession) => {
    set({ selectedSession: session });
  },

  // Generate tests
  generateTests: async (sessionId: string, options: any) => {
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

  // Load settings
  loadSettings: async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SETTINGS',
      }).catch((error) => {
        console.log('Failed to get settings:', error);
        return { success: false };
      });

      if (response && response.success) {
        set({ settings: response.settings });
      } else {
        // Set default settings if failed to load
        set({ 
          settings: {
            aiProvider: 'openai',
            aiModel: 'gpt-4o-mini',
            apiKeys: {},
            testFramework: 'jest',
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
              maxTokens: 4000,
              temperature: 0.7,
              retryAttempts: 3,
              timeout: 30000,
              cacheResponses: true,
            },
          }
        });
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
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

  // Clear error
  clearError: () => {
    set({ error: undefined });
  },

  // Set loading
  setLoading: (loading: boolean) => {
    set({ loading });
  },
}));