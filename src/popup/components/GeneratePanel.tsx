import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  Paper,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Divider,
  Alert,
  Chip,
  LinearProgress,
  Tooltip,
  Radio,
  RadioGroup,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  Slider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import AutoAwesome from '@mui/icons-material/AutoAwesome';
import Download from '@mui/icons-material/Download';
import Info from '@mui/icons-material/Info';
import ExpandMore from '@mui/icons-material/ExpandMore';
import RocketLaunch from '@mui/icons-material/RocketLaunch';
import Security from '@mui/icons-material/Security';
import Speed from '@mui/icons-material/Speed';
import Api from '@mui/icons-material/Api';
import DataObject from '@mui/icons-material/DataObject';
import Delete from '@mui/icons-material/Delete';
import SelectAll from '@mui/icons-material/SelectAll';
import Stop from '@mui/icons-material/Stop';
import { RecordingSession, TestFramework, AIProvider, AIModel, NetworkRequest } from '@/types';
import { useStore } from '@/store/useStore';
import EndpointPreview from './EndpointPreview';
import RequestList from './RequestList';
import GenerationProgress from './GenerationProgress';
import GeneratedResults from './GeneratedResults';
import ReplayPanel from './ReplayPanel';
import CostEstimator from './CostEstimator';
import { MODEL_OPTIONS } from './modelOptions';
import { Logger } from '@/services/logging/Logger';
import { getEndpointSignature } from '@/services/EndpointGrouper';
import { DataMaskingService } from '@/services/DataMaskingService';
import { estimateCost } from './CostEstimator';
import { SecurityFindings, SecurityFinding } from './SecurityFindings';

// Default ceiling for a single generation run. If the estimate exceeds this the
// user is asked to confirm before any spend. Overridable via
// settings.advanced.maxGenerationCost. (plan.md 3.3)
const DEFAULT_COST_CAP_USD = 0.5;
import {
  ParallelGenerationOrchestrator,
  ParallelGenerationResult,
  GenerationProgress as GenerationProgressType,
  GenerationOptions as ParallelOptions
} from '@/services/ParallelGenerationOrchestrator';

interface GeneratePanelProps {
  sessions: RecordingSession[];
}

interface GenerationState {
  isGenerating: boolean;
  progress: number;
  stage: string;
  estimatedTime: number;
  currentEndpoint?: number;
  totalEndpoints?: number;
  endpointName?: string;
}

// Scans the requests that WILL be sent to the LLM (respecting the user's
// endpoint exclusions) for residual sensitive data that survived masking.
// Returns the distinct types found and a total match count.
function scanForSensitiveData(
  requests: NetworkRequest[],
  excluded: Set<string>
): { types: string[]; count: number } | null {
  const masking = DataMaskingService.getInstance();
  const types = new Set<string>();
  let count = 0;

  for (const req of requests) {
    if (excluded.has(getEndpointSignature(req))) continue;
    const parts = [
      req.url,
      JSON.stringify(req.requestHeaders || {}),
      JSON.stringify(req.responseHeaders || {}),
      typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody || ''),
      typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody || ''),
    ];
    for (const part of parts) {
      if (!part) continue;
      const report = masking.detectSensitiveData(part);
      if (report.hasSensitiveData) {
        report.types.forEach(t => types.add(t));
        count += report.count;
      }
    }
  }

  return count > 0 ? { types: Array.from(types), count } : null;
}

export default function GeneratePanel({ sessions }: GeneratePanelProps) {
  const { selectedSession, generateTests, cancelGeneration, deleteRequests, settings, loadSettings, generatedTests } = useStore();
  const [framework, setFramework] = useState<TestFramework>('jest');
  const [provider, setProvider] = useState<AIProvider>('openai');
  const [model, setModel] = useState<AIModel>('gpt-4.1-mini');
  const [hasUserChangedModel, setHasUserChangedModel] = useState(false);
  const isInitialLoadRef = useRef(true);
  // Pre-send sensitive-data gate: residual secrets/PII detected in the
  // (already-masked) payload just before it would be uploaded to the LLM.
  const [sensitiveReport, setSensitiveReport] = useState<{ types: string[]; count: number } | null>(null);
  const sensitiveAckRef = useRef(false);
  // Cost gate: shown when the estimated spend exceeds the cap.
  const [costGate, setCostGate] = useState<{ cost: number; cap: number } | null>(null);
  const costAckRef = useRef(false);
  // Generic promise-based confirm dialog (replaces alert()/window.confirm()).
  const [confirmState, setConfirmState] = useState<{ title: string; message: string; confirmLabel: string } | null>(null);
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const askConfirm = (opts: { title: string; message: string; confirmLabel: string }) =>
    new Promise<boolean>((resolve) => { confirmResolveRef.current = resolve; setConfirmState(opts); });
  const resolveConfirm = (v: boolean) => {
    setConfirmState(null);
    const r = confirmResolveRef.current;
    confirmResolveRef.current = null;
    r?.(v);
  };
  const [options, setOptions] = useState({
    // Default to comprehensive testing
    includeAuth: true,
    includeErrorScenarios: true,
    includePerformanceTests: true,
    includeSecurityTests: true,
    generateMockData: true,
    includeEdgeCases: true,
    testCoverage: 'standard' as 'exhaustive' | 'standard' | 'minimal',
  });
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [excludedEndpoints, setExcludedEndpoints] = useState<Set<string>>(new Set());
  const [requestSelectionMode, setRequestSelectionMode] = useState(false);
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
  const [generationState, setGenerationState] = useState<GenerationState>({
    isGenerating: false,
    progress: 0,
    stage: '',
    estimatedTime: 0,
  });

  // Parallel generation state
  const [parallelEnabled, setParallelEnabled] = useState(false);
  const [parallelOptions, setParallelOptions] = useState<ParallelOptions>({
    enableAssertions: true,
    enablePerformance: true,
    enableOpenAPI: true,
    enableGraphQL: true,
    enableScenarios: true,
    enableDataDriven: true,
    enableSecurity: true,
    enableAutoHealing: true,
    enableEnvironment: true,
    enableAITests: true, // Enable AI test generation by default
    framework: 'jest',
    maxConcurrency: 3,
    // AI settings (will be set from main options)
    aiProvider: provider,
    aiModel: model,
    includeAuth: options.includeAuth,
    includeErrorScenarios: options.includeErrorScenarios,
    includePerformanceTests: options.includePerformanceTests,
    includeSecurityTests: options.includeSecurityTests,
    generateMockData: options.generateMockData
  });
  const [parallelProgress, setParallelProgress] = useState<GenerationProgressType | null>(null);
  const [parallelResult, setParallelResult] = useState<ParallelGenerationResult | null>(null);
  const [_resultTab, _setResultTab] = useState(0);
  const [securityScanning, setSecurityScanning] = useState(false);
  const [securityResults, setSecurityResults] = useState<SecurityFinding[]>([]);
  const [expandedFinding, setExpandedFinding] = useState<number | null>(null);
  const [maintenanceHints, setMaintenanceHints] = useState<{ newEndpoints: string[]; changedSchemas: string[]; removedEndpoints: string[] } | null>(null);

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Restore persisted generation state on mount (survives popup close/reopen)
  useEffect(() => {
    chrome.storage.session.get('generationState').then((data) => {
      const state = data.generationState;
      if (!state) return;

      if (state.status === 'generating') {
        setGenerationState({
          isGenerating: true,
          progress: state.progress || 0,
          stage: state.stage || 'Generating...',
          estimatedTime: 0,
          currentEndpoint: state.currentEndpoint,
          totalEndpoints: state.totalEndpoints,
          endpointName: state.endpointName,
        });
      } else if (state.status === 'complete' && state.result) {
        setGeneratedCode(state.result.code || '');
        setGenerationState(prev => ({ ...prev, isGenerating: false, progress: 100, stage: 'Complete' }));
        // Clear stored state after consuming
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch((e: unknown) => Logger.getInstance().warn('Failed to clear generation state', { error: e }, 'GeneratePanel'));
      } else if (state.status === 'cancelled') {
        setGenerationState(prev => ({ ...prev, isGenerating: false, progress: 0, stage: 'Generation cancelled' }));
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch(() => {});
      } else if (state.status === 'error') {
        setGenerationState(prev => ({ ...prev, isGenerating: false, progress: 0, stage: state.error || 'Failed' }));
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch((e: unknown) => Logger.getInstance().warn('Failed to clear generation state', { error: e }, 'GeneratePanel'));
      }
    }).catch((e: unknown) => Logger.getInstance().warn('Failed to restore generation state', { error: e }, 'GeneratePanel'));

    // Listen for storage changes (real-time updates from background)
    const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
      if (area !== 'session' || !changes.generationState) return;
      const state = changes.generationState.newValue;
      if (!state) return;

      if (state.status === 'generating') {
        setGenerationState(prev => ({
          ...prev,
          isGenerating: true,
          progress: state.progress || prev.progress,
          stage: state.stage || prev.stage,
          currentEndpoint: state.currentEndpoint,
          totalEndpoints: state.totalEndpoints,
          endpointName: state.endpointName,
        }));
      } else if (state.status === 'complete' && state.result) {
        setGeneratedCode(state.result.code || '');
        setGenerationState(prev => ({ ...prev, isGenerating: false, progress: 100, stage: 'Complete' }));
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch((e: unknown) => Logger.getInstance().warn('Failed to clear generation state', { error: e }, 'GeneratePanel'));
      } else if (state.status === 'cancelled') {
        setGenerationState(prev => ({ ...prev, isGenerating: false, progress: 0, stage: 'Generation cancelled' }));
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch(() => {});
      } else if (state.status === 'error') {
        setGenerationState(prev => ({ ...prev, isGenerating: false, progress: 0, stage: state.error || 'Failed' }));
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch((e: unknown) => Logger.getInstance().warn('Failed to clear generation state', { error: e }, 'GeneratePanel'));
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Listen for generation progress updates (direct messages, faster when popup is open)
  useEffect(() => {
    const handleProgressMessage = (message: any) => {
      if (message.type === 'GENERATION_PROGRESS') {
        const { current, total, stage, endpoint } = message.payload;
        setGenerationState(prev => ({
          ...prev,
          currentEndpoint: current,
          totalEndpoints: total,
          stage: stage,
          endpointName: endpoint,
          progress: Math.min(95, Math.round((current / total) * 60) + 25), // 25-85% for generation phase
        }));
      }
    };

    chrome.runtime.onMessage.addListener(handleProgressMessage);
    return () => chrome.runtime.onMessage.removeListener(handleProgressMessage);
  }, []);

  // Sync parallel options with main generation options
  useEffect(() => {
    setParallelOptions(prev => ({
      ...prev,
      framework,
      aiProvider: provider,
      aiModel: model,
      includeAuth: options.includeAuth,
      includeErrorScenarios: options.includeErrorScenarios,
      includePerformanceTests: options.includePerformanceTests,
      includeSecurityTests: options.includeSecurityTests,
      generateMockData: options.generateMockData
    }));
  }, [framework, provider, model, options]);

  // Watch for changes in generatedTests from the store
  useEffect(() => {
    if (generatedTests.length > 0 && !generatedCode) {
      const latestTest = generatedTests[generatedTests.length - 1];
      if (latestTest && latestTest.code) {
        setGeneratedCode(latestTest.code);
      }
    }
  }, [generatedTests]);

  // Update provider and model from settings only on initial mount
  useEffect(() => {
    if (settings && isInitialLoadRef.current) {
      setProvider(settings.aiProvider || 'openai');
      if (!hasUserChangedModel) {
        setModel(settings.aiModel || 'gpt-4.1-mini');
      }
      isInitialLoadRef.current = false;
    }
  }, [settings]);

  // Use selectedSession (which includes uploaded HAR sessions) or fallback to first session
  const session = selectedSession || sessions[0];

  // Load maintenance hints when session changes
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const { ContractSnapshotService } = await import('@/services/ContractSnapshotService');
        const hints = await ContractSnapshotService.getInstance().getMaintenanceHints(session);
        if (hints.newEndpoints.length > 0 || hints.changedSchemas.length > 0 || hints.removedEndpoints.length > 0) {
          setMaintenanceHints(hints);
        } else {
          setMaintenanceHints(null);
        }
      } catch {
        setMaintenanceHints(null);
      }
    })();
  }, [session?.id]);

  // Handle endpoint inclusion/exclusion
  const handleEndpointToggle = (signature: string, excluded: boolean) => {
    setExcludedEndpoints(prev => {
      const newSet = new Set(prev);
      if (excluded) {
        newSet.add(signature);
      } else {
        newSet.delete(signature);
      }
      return newSet;
    });
  };

  // Reset excluded endpoints when session changes
  React.useEffect(() => {
    setExcludedEndpoints(new Set());
    sensitiveAckRef.current = false;
    setSensitiveReport(null);
    costAckRef.current = false;
    setCostGate(null);
  }, [session?.id]);

  const handleGenerate = async () => {
    if (!session) return;

    // Check if API key is configured for the selected provider
    const apiKeys = settings?.apiKeys || {};
    const providerKeyMap: Record<string, string> = {
      openai: apiKeys.openai || '',
      anthropic: apiKeys.anthropic || '',
      gemini: apiKeys.gemini || '',
      local: 'not-required',
    };

    if (provider !== 'local' && !providerKeyMap[provider]) {
      const openSettings = await askConfirm({
        title: 'API key required',
        message: `Configure your ${provider.toUpperCase()} API key in the extension settings before generating.`,
        confirmLabel: 'Open settings',
      });
      if (openSettings) chrome.runtime.openOptionsPage();
      return;
    }

    // Pre-send sensitive-data gate. The payload is already masked, but masking
    // is best-effort — scan the outgoing bodies/headers/URLs one more time and,
    // if anything secret-looking survived, block until the user confirms.
    // Skipped for the local (Ollama) provider, which never leaves the machine.
    if (provider !== 'local' && !sensitiveAckRef.current) {
      const report = scanForSensitiveData(session.requests || [], excludedEndpoints);
      if (report && report.count > 0) {
        setSensitiveReport(report);
        return;
      }
    }

    // Cost gate (plan.md 3.3): if the estimated spend exceeds the cap, confirm
    // before making any paid API calls. Free for the local provider.
    if (provider !== 'local' && !costAckRef.current) {
      const cap = settings?.advanced?.maxGenerationCost ?? DEFAULT_COST_CAP_USD;
      const { cost } = estimateCost(session, provider, model, options, excludedEndpoints);
      if (cost > cap) {
        setCostGate({ cost, cap });
        return;
      }
    }

    // Both gates passed — consume the acknowledgements for this run.
    sensitiveAckRef.current = false;
    costAckRef.current = false;

    // Calculate real estimates based on endpoints and provider
    const requests = session.requests || [];
    const includedSigs = new Set<string>();
    requests.forEach(req => {
      const sig = getEndpointSignature(req);
      if (!excludedEndpoints.has(sig)) includedSigs.add(sig);
    });
    const uniqueEndpoints = Array.from(includedSigs);
    
    // More accurate timing based on provider and complexity
    const timePerEndpoint = {
      'openai': 2,      // Fast
      'gemini': 3,      // Medium
      'anthropic': 4,   // Slower but higher quality
      'local': 1        // Fastest
    }[provider] || 2;
    
    const baseTime = 8; // Setup, connection, finalization
    const totalEstimatedTime = Math.max(10, (uniqueEndpoints.length * timePerEndpoint) + baseTime);
    const startTime = Date.now();

        // Start generation process with real estimates
        setGenerationState({
          isGenerating: true,
          progress: 0,
          stage: 'Initializing test generation...',
          estimatedTime: totalEstimatedTime,
          currentEndpoint: undefined,
          totalEndpoints: undefined,
          endpointName: undefined,
        });

    // Real-time progress tracking helper
    const updateProgress = (progress: number, stage: string) => {
      const elapsedTime = Math.floor((Date.now() - startTime) / 1000);
      const remainingTime = Math.max(1, totalEstimatedTime - elapsedTime);
      
      setGenerationState(prev => ({
        ...prev,
        progress: Math.min(99, Math.max(progress, prev.progress)), // Always advance, never go backwards
        stage,
        estimatedTime: remainingTime,
      }));
    };

    const excludedArray = Array.from(excludedEndpoints);

    const generationOptions = {
      framework,
      provider,
      model, // Use the local model state instead of settings
      ...options,
      complexity: 'intermediate' as const,
      excludedEndpoints: excludedArray, // Convert Set to Array for serialization
    };

    try {
      // Honest progress only: show that we've started, then let the real
      // GENERATION_PROGRESS messages (emitted per-endpoint by the background
      // service via the listener above) drive the bar between 25% and 95%.
      // No fabricated sleeps or scripted stage strings.
      updateProgress(5, `Preparing ${uniqueEndpoints.length} API endpoints for ${provider.toUpperCase()} (${model})...`);

      // Call the actual generateTests through the store. While this awaits, the
      // GENERATION_PROGRESS listener updates currentEndpoint/totalEndpoints/stage.
      const generatedTest = await generateTests(session.id, generationOptions);

      // Use the returned test directly
      if (generatedTest && generatedTest.code) {
        setGeneratedCode(generatedTest.code);
        updateProgress(97, 'Finalizing test suite...');
      }

      // Complete (100%)
      setGenerationState(prev => ({
        ...prev,
        progress: 100,
        stage: `🎉 Generated ${framework.toUpperCase()} tests for ${uniqueEndpoints.length} endpoints!`,
        estimatedTime: 0,
      }));
      
          setTimeout(() => {
            setGenerationState({
              isGenerating: false,
              progress: 0,
              stage: '',
              estimatedTime: 0,
              currentEndpoint: undefined,
              totalEndpoints: undefined,
              endpointName: undefined,
            });
          }, 2500);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isCancelled = errorMessage.includes('cancelled') || errorMessage.includes('aborted');
      if (isCancelled) return; // handleCancel already set state

      const elapsedTime = Math.floor((Date.now() - startTime) / 1000);

      setGenerationState({
        isGenerating: false,
        progress: 0,
        stage: `❌ Generation failed after ${elapsedTime}s: ${errorMessage}`,
        estimatedTime: 0,
        currentEndpoint: undefined,
        totalEndpoints: undefined,
        endpointName: undefined,
      });
      
      // Clear error message after 4 seconds
      setTimeout(() => {
        setGenerationState(prev => ({
          ...prev,
          stage: '',
        }));
      }, 4000);
    }
  };

  const handleCancel = async () => {
    await cancelGeneration();
    // Also cancel parallel generation if running
    if (parallelEnabled) {
      ParallelGenerationOrchestrator.getInstance().abort();
    }
    setGenerationState({
      isGenerating: false,
      progress: 0,
      stage: 'Generation cancelled',
      estimatedTime: 0,
      currentEndpoint: undefined,
      totalEndpoints: undefined,
      endpointName: undefined,
    });
  };

  // Parallel generation handlers
  const handleParallelOptionChange = (key: keyof ParallelOptions) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setParallelOptions(prev => ({ ...prev, [key]: event.target.checked }));
  };

  const handleParallelGenerate = useCallback(async () => {
    if (!session) return;

    const parallelStartTime = Date.now();

    setGenerationState(prev => ({
      ...prev,
      isGenerating: true,
      progress: 0,
      stage: 'Initializing parallel generation...',
      estimatedTime: 0,
    }));
    setParallelProgress(null);
    setParallelResult(null);

    try {
      const orchestrator = ParallelGenerationOrchestrator.getInstance();
      const excludedArray = Array.from(excludedEndpoints);
      const result = await orchestrator.generateAll(
        session,
        { ...parallelOptions, framework, excludedEndpoints: excludedArray },
        (prog) => {
          setParallelProgress(prog);
          // Compute remaining time from elapsed time and progress rate
          const elapsedSec = (Date.now() - parallelStartTime) / 1000;
          const rate = prog.overall > 0 ? elapsedSec / prog.overall : 0; // seconds per %
          const remainingSec = rate > 0 ? Math.ceil((100 - prog.overall) * rate) : 0;
          // Update main generation state progress
          setGenerationState(prev => ({
            ...prev,
            progress: prog.overall,
            stage: prog.currentTask ? `Running: ${prog.currentTask}` : 'Processing...',
            estimatedTime: remainingSec,
          }));
        }
      );

      setParallelResult(result);

      // Also set the generated code for the main view
      if (result) {
        const combinedCode = orchestrator.generateCombinedTestCode(result, framework);
        setGeneratedCode(combinedCode);
      }

      // Mark as complete
      setGenerationState(prev => ({
        ...prev,
        progress: 100,
        stage: 'Generation complete!'
      }));
    } catch (error) {
      console.error('Parallel generation failed:', error);
      setGenerationState(prev => ({
        ...prev,
        stage: 'Generation failed. Please try again.'
      }));
    } finally {
      setGenerationState(prev => ({ ...prev, isGenerating: false }));
    }
  }, [session, parallelOptions, framework, excludedEndpoints]);

  const handleParallelDownload = useCallback((type: 'tests' | 'openapi' | 'graphql' | 'env' | 'security') => {
    if (!parallelResult) return;

    const orchestrator = ParallelGenerationOrchestrator.getInstance();
    let content = '';
    let filename = '';

    switch (type) {
      case 'tests':
        content = orchestrator.generateCombinedTestCode(parallelResult, framework);
        filename = `tests.${framework === 'playwright' ? 'spec.ts' : 'test.js'}`;
        break;
      case 'openapi':
        content = orchestrator.exportOpenAPISpec(parallelResult) || '';
        filename = 'openapi.json';
        break;
      case 'graphql':
        content = orchestrator.exportGraphQLSchema(parallelResult) || '';
        filename = 'schema.graphql';
        break;
      case 'env':
        content = orchestrator.exportEnvironmentFile(parallelResult) || '';
        filename = '.env.example';
        break;
      case 'security':
        content = orchestrator.exportSecurityReport(parallelResult);
        filename = 'security-report.md';
        break;
    }

    if (content) {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [parallelResult, framework]);

  const enabledParallelCount = Object.entries(parallelOptions)
    .filter(([key, value]) => key.startsWith('enable') && value === true)
    .length;

  // Compute active endpoint count for the Generate button label
  const activeEndpointCount = useMemo(() => {
    if (!session) return 0;
    const included = new Set<string>();
    session.requests.forEach(req => {
      const sig = getEndpointSignature(req);
      if (!excludedEndpoints.has(sig)) {
        included.add(sig);
      }
    });
    return included.size;
  }, [session, excludedEndpoints]);

  if (!session) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Info sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="body2" color="text.secondary">
          No session selected
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Select or upload a session to generate tests
        </Typography>
      </Box>
    );
  }

  // Check if API key is configured
  const isApiKeyConfigured = () => {
    if (provider === 'local') return true;
    const apiKeys = settings?.apiKeys || {};
    const keyMap: Record<string, string> = {
      openai: apiKeys.openai || '',
      anthropic: apiKeys.anthropic || '',
      gemini: apiKeys.gemini || '',
    };
    return !!keyMap[provider];
  };

  return (
    <Box sx={{ position: 'relative' }}>

      {/* API Key Warning */}
      {!isApiKeyConfigured() && (
        <Alert severity="warning" sx={{ mb: 2 }} action={
          <Button color="inherit" size="small" onClick={() => chrome.runtime.openOptionsPage()}>
            Configure
          </Button>
        }>
          {`${provider.toUpperCase()} API key not configured. Please add it in settings.`}
        </Alert>
      )}

      {/* Session Info */}
      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Selected Session
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2">{session.name}</Typography>
          <Chip label={`${session.requests.length} requests`} size="small" />
          {session.id.startsWith('uploaded_') && (
            <Chip label="Uploaded" size="small" color="info" />
          )}
        </Box>

        {/* Maintenance Hints */}
        {maintenanceHints && (
          <Alert severity="info" sx={{ mb: 1, fontSize: '0.75rem' }}>
            <Typography variant="caption" fontWeight={600}>Test Maintenance Hints:</Typography>
            {maintenanceHints.newEndpoints.length > 0 && (
              <Typography variant="caption" display="block">{maintenanceHints.newEndpoints.length} new endpoint{maintenanceHints.newEndpoints.length > 1 ? 's' : ''} detected</Typography>
            )}
            {maintenanceHints.changedSchemas.length > 0 && (
              <Typography variant="caption" display="block">Schema changes in: {maintenanceHints.changedSchemas.join(', ')}</Typography>
            )}
            {maintenanceHints.removedEndpoints.length > 0 && (
              <Typography variant="caption" display="block">{maintenanceHints.removedEndpoints.length} endpoint{maintenanceHints.removedEndpoints.length > 1 ? 's' : ''} no longer present</Typography>
            )}
          </Alert>
        )}

        {/* Endpoint Preview */}
        <EndpointPreview
          session={session}
          showDetails={false}
          excludedEndpoints={excludedEndpoints}
          onEndpointToggle={handleEndpointToggle}
        />

        {/* Security Scan */}
        <Accordion sx={{ mt: 1 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Security fontSize="small" color="warning" />
              <Typography variant="subtitle2">Security Scan</Typography>
              {securityResults.length > 0 && (
                <Chip
                  label={`${securityResults.filter(r => r.status === 'vulnerable').length} issues`}
                  size="small"
                  color={securityResults.some(r => r.status === 'vulnerable') ? 'error' : 'success'}
                  sx={{ height: 18, fontSize: '0.65rem' }}
                />
              )}
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Button
              variant="outlined"
              size="small"
              startIcon={<Security />}
              disabled={securityScanning}
              onClick={async () => {
                const baseUrl = session.url || session.requests[0]?.url?.replace(/\/[^/]*$/, '') || '';
                // Active scanning fires real requests from the user's authenticated
                // context. Require explicit, target-specific authorization first.
                const authorized = await askConfirm({
                  title: 'Authorize active security scan',
                  message:
                    `Run an ACTIVE security scan against:\n\n${baseUrl}\n\n` +
                    `This sends real attack-style requests from your logged-in browser session. ` +
                    `Only proceed if you own or are explicitly authorized to test this target. ` +
                    `Destructive payloads (DROP/DELETE/time-delay) are skipped by default.`,
                  confirmLabel: 'Run scan',
                });
                if (!authorized) return;
                setSecurityScanning(true);
                setSecurityResults([]);
                try {
                  const { SecurityTestGenerator } = await import('@/services/SecurityTestGenerator');
                  const { SecurityTestRunner } = await import('@/services/SecurityTestRunner');
                  const generator = SecurityTestGenerator.getInstance();
                  const runner = SecurityTestRunner.getInstance();
                  const suites = generator.generateSecurityTests(session);
                  const allResults: typeof securityResults = [];
                  for (const suite of suites) {
                    const _scanResult = await runner.runSuite(suite, baseUrl, { authorized: true, allowDestructive: false }, (_c, _t, result) => {
                      allResults.push({
                        testName: result.testName,
                        status: result.status,
                        details: result.details,
                        responseStatus: result.responseStatus,
                        severity: result.severity,
                        description: result.description,
                        owaspReference: result.owaspReference,
                        method: result.method,
                        url: result.url,
                        payload: result.payload,
                        evidence: result.evidence,
                        confidence: result.confidence,
                        remediation: result.remediation,
                      });
                      setSecurityResults([...allResults]);
                    });
                  }
                } catch (error) {
                  Logger.getInstance().error('Security scan failed', error, 'GeneratePanel');
                } finally {
                  setSecurityScanning(false);
                }
              }}
              fullWidth
              sx={{ mb: 1 }}
            >
              {securityScanning ? 'Scanning...' : 'Run Security Scan'}
            </Button>
            {securityScanning && <LinearProgress sx={{ mb: 1 }} />}
            <SecurityFindings results={securityResults} expanded={expandedFinding} onToggle={setExpandedFinding} />
          </AccordionDetails>
        </Accordion>

        {/* Manage Requests */}
        <Accordion sx={{ mt: 1 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="subtitle2">
              Manage Requests ({session.requests.length})
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
              <Button
                size="small"
                variant={requestSelectionMode ? 'contained' : 'outlined'}
                onClick={() => {
                  setRequestSelectionMode(!requestSelectionMode);
                  if (requestSelectionMode) setSelectedRequestIds(new Set());
                }}
              >
                {requestSelectionMode ? 'Cancel' : 'Select'}
              </Button>
              {requestSelectionMode && (
                <>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<SelectAll />}
                    onClick={() => setSelectedRequestIds(new Set(session.requests.map(r => r.id)))}
                  >
                    All
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => setSelectedRequestIds(new Set())}
                  >
                    None
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    color="error"
                    startIcon={<Delete />}
                    disabled={selectedRequestIds.size === 0}
                    onClick={async () => {
                      if (selectedRequestIds.size > 0) {
                        await deleteRequests(session.id, Array.from(selectedRequestIds));
                        setSelectedRequestIds(new Set());
                        setRequestSelectionMode(false);
                      }
                    }}
                  >
                    Delete ({selectedRequestIds.size})
                  </Button>
                </>
              )}
            </Box>
            <RequestList
              requests={session.requests}
              selectionMode={requestSelectionMode}
              selectedIds={selectedRequestIds}
              onToggleSelect={(id) => {
                setSelectedRequestIds(prev => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id); else next.add(id);
                  return next;
                });
              }}
            />
          </AccordionDetails>
        </Accordion>
      </Paper>

      {/* Generation Options */}
      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Generation Options
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Test Framework</InputLabel>
            <Select
              value={framework}
              onChange={(e) => setFramework(e.target.value as TestFramework)}
              label="Test Framework"
              disabled={generationState.isGenerating}
            >
              <MenuItem value="playwright">Playwright</MenuItem>
              <MenuItem value="jest">Jest</MenuItem>
              <MenuItem value="vitest">Vitest</MenuItem>
              <MenuItem value="cypress">Cypress</MenuItem>
              <MenuItem value="supertest">Supertest</MenuItem>
              <MenuItem value="mocha-chai">Mocha/Chai</MenuItem>
              <MenuItem value="pactum">PactumJS</MenuItem>
              <MenuItem value="k6">k6 (Load Testing)</MenuItem>
              <MenuItem value="artillery">Artillery</MenuItem>
              <MenuItem value="pytest">Pytest (Python)</MenuItem>
              <MenuItem value="httpx">HTTPX (Python)</MenuItem>
              <MenuItem value="restassured">REST Assured (Java)</MenuItem>
              <MenuItem value="karate">Karate (Java)</MenuItem>
              <MenuItem value="postman">Postman Collection</MenuItem>
              <MenuItem value="puppeteer">Puppeteer</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel>AI Provider</InputLabel>
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AIProvider)}
              label="AI Provider"
              disabled={generationState.isGenerating}
            >
              <MenuItem value="openai">OpenAI</MenuItem>
              <MenuItem value="anthropic">Claude</MenuItem>
              <MenuItem value="gemini">Gemini</MenuItem>
              <MenuItem value="local">Local Model</MenuItem>
            </Select>
          </FormControl>
        </Box>

        <Box sx={{ mb: 2 }}>
          <FormControl size="small" fullWidth>
            <InputLabel>Model</InputLabel>
            <Select
              value={model}
              onChange={(e) => {
                const newModel = e.target.value as AIModel;
                setModel(newModel);
                setHasUserChangedModel(true);
              }}
              label="Model"
              disabled={generationState.isGenerating}
            >
              {MODEL_OPTIONS.map((modelOption) => (
                <MenuItem key={modelOption.value} value={modelOption.value}>
                  {modelOption.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        <Divider sx={{ my: 2 }} />

        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeAuth}
                onChange={(e) =>
                  setOptions({ ...options, includeAuth: e.target.checked })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Authentication Tests"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeErrorScenarios}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    includeErrorScenarios: e.target.checked,
                  })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Error Scenarios (4xx, 5xx)"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includePerformanceTests}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    includePerformanceTests: e.target.checked,
                  })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Performance Tests"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeSecurityTests}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    includeSecurityTests: e.target.checked,
                  })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Security Tests"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.generateMockData}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    generateMockData: e.target.checked,
                  })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Generate Mock Data"
          />
        </FormGroup>

        <Divider sx={{ my: 2 }} />

        <FormGroup>
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeEdgeCases}
                onChange={(e) =>
                  setOptions({ ...options, includeEdgeCases: e.target.checked })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Edge Cases (null, boundary, special chars)"
          />
        </FormGroup>

        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Test Coverage Level
          </Typography>
          <RadioGroup
            value={options.testCoverage}
            onChange={(e) => setOptions({ ...options, testCoverage: e.target.value as any })}
            row
          >
            <FormControlLabel value="minimal" control={<Radio size="small" />} label="Minimal" />
            <FormControlLabel value="standard" control={<Radio size="small" />} label="Standard" />
            <FormControlLabel value="exhaustive" control={<Radio size="small" />} label="Exhaustive" />
          </RadioGroup>
        </Box>
      </Paper>

      {/* Cost Estimate */}
      {!settings?.apiKeys[provider as keyof typeof settings.apiKeys] && provider !== 'local' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          API key not configured for {provider}. Please configure it in settings.
        </Alert>
      )}

      <CostEstimator
        session={session}
        provider={provider}
        model={model}
        options={options}
        excludedEndpoints={excludedEndpoints}
      />

      {/* Advanced Parallel Generation */}
      <Accordion
        expanded={parallelEnabled}
        onChange={(_, expanded) => setParallelEnabled(expanded)}
        sx={{ mb: 2 }}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
            <RocketLaunch color="primary" fontSize="small" />
            <Typography variant="subtitle2">Advanced Parallel Generation</Typography>
            <Chip
              label={`${enabledParallelCount} features`}
              size="small"
              color="primary"
              variant="outlined"
              sx={{ ml: 'auto', mr: 1 }}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
            Generate tests, OpenAPI specs, security reports, and more in parallel
          </Typography>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Analyze request/response pairs to generate intelligent assertions with confidence scores" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enableAssertions} onChange={handleParallelOptionChange('enableAssertions')} size="small" />}
                  label={<Typography variant="body2">Smart Assertions</Typography>}
                />
              </Tooltip>
            </Box>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Generate performance metrics (p50, p95, p99) and response time assertions from recorded timings" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enablePerformance} onChange={handleParallelOptionChange('enablePerformance')} size="small" />}
                  label={<Typography variant="body2">Performance Tests</Typography>}
                />
              </Tooltip>
            </Box>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Infer an OpenAPI 3.0 spec from recorded traffic — paths, schemas, and parameters" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enableOpenAPI} onChange={handleParallelOptionChange('enableOpenAPI')} size="small" />}
                  label={<Typography variant="body2">OpenAPI Spec</Typography>}
                />
              </Tooltip>
            </Box>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Detect GraphQL requests and infer the schema (types, queries, mutations)" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enableGraphQL} onChange={handleParallelOptionChange('enableGraphQL')} size="small" />}
                  label={<Typography variant="body2">GraphQL Schema</Typography>}
                />
              </Tooltip>
            </Box>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Build multi-step test workflows by detecting data dependencies between requests" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enableScenarios} onChange={handleParallelOptionChange('enableScenarios')} size="small" />}
                  label={<Typography variant="body2">Test Scenarios</Typography>}
                />
              </Tooltip>
            </Box>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Generate parameterized test datasets — valid variations, boundary values, and negative tests" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enableDataDriven} onChange={handleParallelOptionChange('enableDataDriven')} size="small" />}
                  label={<Typography variant="body2">Data-Driven Tests</Typography>}
                />
              </Tooltip>
            </Box>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Generate OWASP Top 10 security tests — SQL injection, XSS, auth bypass, and more" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enableSecurity} onChange={handleParallelOptionChange('enableSecurity')} size="small" />}
                  label={<Typography variant="body2">Security Tests</Typography>}
                />
              </Tooltip>
            </Box>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Generate self-healing test wrappers that detect and adapt to breaking API changes" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enableAutoHealing} onChange={handleParallelOptionChange('enableAutoHealing')} size="small" />}
                  label={<Typography variant="body2">Auto-Healing</Typography>}
                />
              </Tooltip>
            </Box>
            <Box sx={{ width: '48%' }}>
              <Tooltip title="Extract environment variables (tokens, API keys, IDs) and generate .env files" arrow enterDelay={200}>
                <FormControlLabel
                  control={<Switch checked={parallelOptions.enableEnvironment} onChange={handleParallelOptionChange('enableEnvironment')} size="small" />}
                  label={<Typography variant="body2">Environment Vars</Typography>}
                />
              </Tooltip>
            </Box>
          </Box>

          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              Parallel Tasks: {parallelOptions.maxConcurrency}
            </Typography>
            <Slider
              value={parallelOptions.maxConcurrency}
              onChange={(_, value) => setParallelOptions(prev => ({ ...prev, maxConcurrency: value as number }))}
              min={1}
              max={5}
              marks
              valueLabelDisplay="auto"
              size="small"
            />
          </Box>

          {/* Parallel Progress */}
          {generationState.isGenerating && parallelProgress && (
            <Paper sx={{ p: 2, mb: 2, bgcolor: 'background.default' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="body2">
                  {parallelProgress.currentTask ? `Running: ${parallelProgress.currentTask}` : 'Starting...'}
                </Typography>
                <Typography variant="body2" color="primary">
                  {parallelProgress.overall}%
                </Typography>
              </Box>
              <LinearProgress variant="determinate" value={parallelProgress.overall} sx={{ mb: 1 }} />
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {parallelProgress.completedTasks.map(task => (
                  <Chip key={task} label={task} size="small" color="success" variant="outlined" />
                ))}
                {parallelProgress.runningTasks.map(task => (
                  <Chip key={task} label={task} size="small" color="primary" />
                ))}
              </Box>
            </Paper>
          )}

          {/* Parallel Results */}
          {parallelResult && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="success" sx={{ mb: 2 }}>
                Generated in {parallelResult.timing.total}ms
                {parallelResult.errors.length > 0 && ` (${parallelResult.errors.length} errors)`}
              </Alert>

              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" startIcon={<Download />} onClick={() => handleParallelDownload('tests')}>
                  Tests
                </Button>
                {parallelResult.openapi && (
                  <Button size="small" variant="outlined" startIcon={<Api />} onClick={() => handleParallelDownload('openapi')}>
                    OpenAPI
                  </Button>
                )}
                {parallelResult.graphql?.sdl && (
                  <Button size="small" variant="outlined" startIcon={<DataObject />} onClick={() => handleParallelDownload('graphql')}>
                    GraphQL
                  </Button>
                )}
                {parallelResult.environment && (
                  <Button size="small" variant="outlined" onClick={() => handleParallelDownload('env')}>
                    .env
                  </Button>
                )}
                {parallelResult.security && (
                  <Button size="small" variant="outlined" startIcon={<Security />} onClick={() => handleParallelDownload('security')}>
                    Security
                  </Button>
                )}
              </Box>
            </Box>
          )}
        </AccordionDetails>
      </Accordion>

      {/* Generate / Stop Button */}
      {generationState.isGenerating ? (
        <Button
          fullWidth
          variant="contained"
          color="error"
          startIcon={<Stop />}
          onClick={handleCancel}
          sx={{ mb: 2 }}
        >
          Stop Generation
        </Button>
      ) : (
        <Button
          fullWidth
          variant="contained"
          startIcon={<AutoAwesome />}
          onClick={parallelEnabled ? handleParallelGenerate : handleGenerate}
          disabled={provider !== 'local' && !settings?.apiKeys[provider as keyof typeof settings.apiKeys]}
          sx={{ mb: 2 }}
        >
          {parallelEnabled
            ? `Generate All (${enabledParallelCount} features)`
            : `Generate Tests (${activeEndpointCount} endpoint${activeEndpointCount !== 1 ? 's' : ''})`}
        </Button>
      )}

      {/* Generation Progress */}
      <GenerationProgress generationState={generationState} />

      {/* Generated Code */}
      {generatedCode && !generationState.isGenerating && (
        <GeneratedResults
          generatedCode={generatedCode}
          session={session}
          excludedEndpoints={excludedEndpoints}
          generatedTests={generatedTests}
          framework={framework}
        />
      )}

      {/* Traffic Replay */}
      {session && (
        <Accordion sx={{ mt: 2 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box display="flex" alignItems="center" gap={1}>
              <Speed sx={{ fontSize: 18 }} />
              <Typography variant="subtitle2">Traffic Replay</Typography>
              <Chip label={`${session.requests.length} requests`} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <ReplayPanel session={session} />
          </AccordionDetails>
        </Accordion>
      )}

      {/* Pre-send sensitive-data confirmation gate (plan.md 1.6) */}
      <Dialog open={sensitiveReport !== null} onClose={() => setSensitiveReport(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Possible sensitive data detected</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            After masking, the requests you're about to send to <strong>{provider.toUpperCase()}</strong> still
            contain {sensitiveReport?.count} value(s) that look sensitive
            {sensitiveReport?.types.length ? ` (${sensitiveReport.types.join(', ')})` : ''}.
            <Box sx={{ mt: 1 }}>
              This data will leave your browser and be sent to a third-party LLM provider. Review your masking
              settings, or continue if this is safe test data.
            </Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSensitiveReport(null)}>Cancel</Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              sensitiveAckRef.current = true;
              setSensitiveReport(null);
              void handleGenerate();
            }}
          >
            Send anyway
          </Button>
        </DialogActions>
      </Dialog>

      {/* Cost-ceiling confirmation gate (plan.md 3.3) */}
      <Dialog open={costGate !== null} onClose={() => setCostGate(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm generation cost</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            The estimated cost for this run is <strong>${costGate?.cost.toFixed(4)}</strong>, which
            exceeds your ${costGate?.cap.toFixed(2)} limit. This is an estimate — actual cost depends
            on response size.
            <Box sx={{ mt: 1 }}>Proceed with generation?</Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCostGate(null)}>Cancel</Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              costAckRef.current = true;
              setCostGate(null);
              void handleGenerate();
            }}
          >
            Generate anyway
          </Button>
        </DialogActions>
      </Dialog>

      {/* Generic confirm dialog — replaces alert()/window.confirm() (plan.md 6.2) */}
      <Dialog open={confirmState !== null} onClose={() => resolveConfirm(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{confirmState?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ whiteSpace: 'pre-line' }}>{confirmState?.message}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => resolveConfirm(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => resolveConfirm(true)}>{confirmState?.confirmLabel}</Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}