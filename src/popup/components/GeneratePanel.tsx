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
  IconButton,
  CircularProgress,
  Tooltip,
  Radio,
  RadioGroup,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  Slider,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Code,
  AutoAwesome,
  Download,
  CheckCircle,
  Error as ErrorIcon,
  Info,
  ExpandMore,
  RocketLaunch,
  Security,
  Speed,
  Api,
  AccountTree,
  DataObject,
} from '@mui/icons-material';
import { RecordingSession, TestFramework, AIProvider, AIModel } from '@/types';
import { useStore } from '@/store/useStore';
import EndpointPreview from './EndpointPreview';
import GenerationProgress from './GenerationProgress';
import GeneratedResults from './GeneratedResults';
import ReplayPanel from './ReplayPanel';
import CostEstimator from './CostEstimator';
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

export default function GeneratePanel({ sessions }: GeneratePanelProps) {
  const { selectedSession, generateTests, settings, loading, loadSettings, generatedTests } = useStore();
  const [framework, setFramework] = useState<TestFramework>('jest');
  const [provider, setProvider] = useState<AIProvider>('openai');
  const [model, setModel] = useState<AIModel>('gpt-4.1-mini');
  const [hasUserChangedModel, setHasUserChangedModel] = useState(false);
  const isInitialLoadRef = useRef(true);
  const [options, setOptions] = useState({
    // Default to comprehensive testing
    includeAuth: true,
    includeErrorScenarios: true,
    includePerformanceTests: true,
    includeSecurityTests: true,
    generateMockData: true,
    // New exhaustive options
    includeEdgeCases: true,
    includeNullTests: true,
    includeBoundaryTests: true,
    includeDataTypeTests: true,
    includeConcurrencyTests: true,
    includeIdempotencyTests: true,
    testCoverage: 'exhaustive' as 'exhaustive' | 'standard' | 'minimal',
  });
  const [generatedCode, setGeneratedCode] = useState<string>('');
  const [excludedEndpoints, setExcludedEndpoints] = useState<Set<string>>(new Set());
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
  const [resultTab, setResultTab] = useState(0);

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
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch(() => {});
      } else if (state.status === 'error') {
        setGenerationState(prev => ({ ...prev, isGenerating: false, progress: 0, stage: state.error || 'Failed' }));
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch(() => {});
      }
    }).catch(() => {});

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
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch(() => {});
      } else if (state.status === 'error') {
        setGenerationState(prev => ({ ...prev, isGenerating: false, progress: 0, stage: state.error || 'Failed' }));
        chrome.runtime.sendMessage({ type: 'CLEAR_GENERATION_STATE' }).catch(() => {});
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

  // Get all available models in one list
  const getAllAvailableModels = (): { value: AIModel; label: string }[] => {
    return [
      // OpenAI Models
      { value: 'gpt-4.1', label: 'GPT-4.1 (Most Capable)' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Fast & Cheap)' },

      // Anthropic Claude Models
      { value: 'claude-4-sonnet', label: 'Claude 4 Sonnet (Latest)' },
      { value: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },

      // Google Gemini Models
      { value: 'gemini-2-5-pro', label: 'Gemini 2.5 Pro' },
      { value: 'gemini-2-5-flash', label: 'Gemini 2.5 Flash (Fast)' },

      // Local Models
      { value: 'llama-3.2', label: 'Llama 3.2' },
      { value: 'deepseek-coder', label: 'DeepSeek Coder' },
    ];
  };

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
      alert(`Please configure your ${provider.toUpperCase()} API key in the extension settings first.`);
      chrome.runtime.openOptionsPage();
      return;
    }

    // Calculate real estimates based on endpoints and provider
    const requests = session.requests || [];
    const endpoints = requests.map(req => `${req.method} ${req.url}`);
    const uniqueEndpoints = [...new Set(endpoints)].filter(endpoint => 
      !Array.from(excludedEndpoints).some(excluded => endpoint.includes(excluded))
    );
    
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
    console.log(`🔍 [GeneratePanel] Excluded endpoints (${excludedArray.length}):`, excludedArray);
    console.log(`🔍 [GeneratePanel] Active endpoints: ${activeEndpointCount}`);

    const generationOptions = {
      framework,
      provider,
      model, // Use the local model state instead of settings
      ...options,
      complexity: 'intermediate' as const,
      excludedEndpoints: excludedArray, // Convert Set to Array for serialization
    };

    try {
      // Phase 1: Analysis (0-15%)
      updateProgress(5, `Analyzing ${uniqueEndpoints.length} API endpoints...`);
      await new Promise(resolve => setTimeout(resolve, 800));
      updateProgress(15, `Found ${requests.length} requests across ${uniqueEndpoints.length} endpoints`);

      // Phase 2: Provider Connection (15-25%)
      updateProgress(18, `Connecting to ${provider.toUpperCase()} API...`);
      await new Promise(resolve => setTimeout(resolve, 600));
      updateProgress(25, `✅ Connected to ${provider.toUpperCase()} (${model})`);

      // Phase 3: Main Generation (25-85%) - This is where the real work happens
      updateProgress(30, `Generating comprehensive test suite...`);
      
      // Track generation progress through multiple steps
      const generationSteps = [
        { progress: 35, stage: `Processing ${options.testCoverage} test coverage...` },
        { progress: 45, stage: 'Analyzing request/response patterns...' },
        { progress: 55, stage: 'Generating core test logic...' },
        { progress: 65, stage: 'Adding authentication tests...' },
        { progress: 75, stage: 'Creating error scenario tests...' },
      ];

      // Update progress during generation
      let stepIndex = 0;
      const stepInterval = setInterval(() => {
        if (stepIndex < generationSteps.length) {
          const step = generationSteps[stepIndex];
          updateProgress(step.progress, step.stage);
          stepIndex++;
        }
      }, 1200);

      // Call the actual generateTests through the store
      const generatedTest = await generateTests(session.id, generationOptions);
      
      clearInterval(stepInterval);
      
      // Phase 4: Post-processing (85-95%)
      updateProgress(85, 'Optimizing test structure...');
      await new Promise(resolve => setTimeout(resolve, 400));
      updateProgress(90, 'Validating test syntax...');
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Use the returned test directly
      if (generatedTest && generatedTest.code) {
        setGeneratedCode(generatedTest.code);
        updateProgress(95, 'Finalizing test suite...');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Phase 5: Complete (100%)
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

  // Mock function removed - now using real AI generation
  const generateMockTestCode = (session: RecordingSession, framework: string): string => {
    const firstRequest = session.requests[0];
    if (!firstRequest) return '// No requests to generate tests for';

    if (framework === 'restassured') {
      return `// Generated by XHRScribe AI (Java REST Assured)
import io.restassured.RestAssured;
import static io.restassured.RestAssured.*;
import static org.hamcrest.Matchers.*;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

public class ${session.name.replace(/[^a-zA-Z0-9]/g, '')}Tests {
    private static final String BASE_URL = "${new URL(firstRequest.url).origin}";
    
    @BeforeClass
    public void setup() {
        RestAssured.baseURI = BASE_URL;
    }
    
    @Test
    public void test${firstRequest.method}Request() {
        given()
            ${options.includeAuth ? '.header("Authorization", "Bearer " + authToken)' : ''}
        .when()
            .${firstRequest.method.toLowerCase()}("${new URL(firstRequest.url).pathname}")
        .then()
            .statusCode(${firstRequest.status || 200})
            .body(notNullValue());
    }
}`;
    } else if (framework === 'postman') {
      return `{
  "info": {
    "name": "${session.name} API Tests",
    "description": "Generated by XHRScribe AI",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "${firstRequest.method} ${new URL(firstRequest.url).pathname}",
      "request": {
        "method": "${firstRequest.method}",
        "header": [],
        "url": {
          "raw": "${firstRequest.url}",
          "host": ["${new URL(firstRequest.url).hostname}"],
          "path": ["${new URL(firstRequest.url).pathname}"]
        }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status code is ${firstRequest.status || 200}', function () {",
              "    pm.response.to.have.status(${firstRequest.status || 200});",
              "});"
            ]
          }
        }
      ]
    }
  ]
}`;
    } else if (framework === 'jest') {
      return `// Generated by XHRScribe AI
const axios = require('axios');

describe('${session.name} API Tests', () => {
  const baseURL = process.env.API_BASE_URL || '${new URL(firstRequest.url).origin}';
  let authToken;

  beforeAll(async () => {
    // Setup authentication if needed
    ${options.includeAuth ? `
    const authResponse = await axios.post(\`\${baseURL}/auth/login\`, {
      username: process.env.TEST_USERNAME,
      password: process.env.TEST_PASSWORD,
    });
    authToken = authResponse.data.token;` : ''}
  });

${session.requests.slice(0, 5).map(req => `
  test('${req.method} ${new URL(req.url).pathname}', async () => {
    const response = await axios({
      method: '${req.method.toLowerCase()}',
      url: \`\${baseURL}${new URL(req.url).pathname}\`,
      ${options.includeAuth ? 'headers: { Authorization: `Bearer ${authToken}` },' : ''}
      ${req.requestBody ? `data: ${JSON.stringify(req.requestBody)},` : ''}
    });
    
    expect(response.status).toBe(${req.status || 200});
    expect(response.data).toBeDefined();
    ${options.includePerformanceTests ? `
    expect(response.duration).toBeLessThan(1000); // Performance assertion` : ''}
  });
`).join('')}

${options.includeErrorScenarios ? `
  describe('Error Scenarios', () => {
    test('should handle 404 not found', async () => {
      try {
        await axios.get(\`\${baseURL}/non-existent-endpoint\`);
      } catch (error) {
        expect(error.response.status).toBe(404);
      }
    });

    test('should handle 401 unauthorized', async () => {
      try {
        await axios.get(\`\${baseURL}${new URL(firstRequest.url).pathname}\`);
      } catch (error) {
        expect(error.response.status).toBe(401);
      }
    });
  });` : ''}
});`;
    }

    return '// Test generation for ' + framework + ' coming soon';
  };

  // Parallel generation handlers
  const handleParallelOptionChange = (key: keyof ParallelOptions) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setParallelOptions(prev => ({ ...prev, [key]: event.target.checked }));
  };

  const handleParallelGenerate = useCallback(async () => {
    if (!session) return;

    setGenerationState(prev => ({
      ...prev,
      isGenerating: true,
      progress: 0,
      stage: 'Initializing parallel generation...'
    }));
    setParallelProgress(null);
    setParallelResult(null);

    try {
      const orchestrator = ParallelGenerationOrchestrator.getInstance();
      const result = await orchestrator.generateAll(
        session,
        { ...parallelOptions, framework },
        (prog) => {
          setParallelProgress(prog);
          // Update main generation state progress
          setGenerationState(prev => ({
            ...prev,
            progress: prog.overall,
            stage: prog.currentTask ? `Running: ${prog.currentTask}` : 'Processing...'
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
  }, [session, parallelOptions, framework]);

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
    const endpointMap = new Map<string, boolean>();
    session.requests.forEach(req => {
      try {
        const url = new URL(req.url);
        const signature = `${req.method}:${url.pathname}`;
        if (!excludedEndpoints.has(signature)) {
          endpointMap.set(signature, true);
        }
      } catch {
        const signature = `${req.method}:${req.url}`;
        if (!excludedEndpoints.has(signature)) {
          endpointMap.set(signature, true);
        }
      }
    });
    return endpointMap.size;
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

        {/* Endpoint Preview */}
        <EndpointPreview 
          session={session} 
          showDetails={false} 
          excludedEndpoints={excludedEndpoints}
          onEndpointToggle={handleEndpointToggle}
        />
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
              {getAllAvailableModels().map((modelOption) => (
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
        
        <Typography variant="subtitle2" gutterBottom color="primary">
          Exhaustive Testing Options (for &gt;80% coverage)
        </Typography>
        
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
            label="Include Edge Cases (special chars, unicode, emoji)"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeNullTests}
                onChange={(e) =>
                  setOptions({ ...options, includeNullTests: e.target.checked })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Null/Undefined Tests"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeBoundaryTests}
                onChange={(e) =>
                  setOptions({ ...options, includeBoundaryTests: e.target.checked })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Boundary Tests (min/max values)"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeDataTypeTests}
                onChange={(e) =>
                  setOptions({ ...options, includeDataTypeTests: e.target.checked })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Data Type Validation"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeConcurrencyTests}
                onChange={(e) =>
                  setOptions({ ...options, includeConcurrencyTests: e.target.checked })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Concurrency Tests"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={options.includeIdempotencyTests}
                onChange={(e) =>
                  setOptions({ ...options, includeIdempotencyTests: e.target.checked })
                }
                size="small"
                disabled={generationState.isGenerating}
              />
            }
            label="Include Idempotency Tests"
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
            <FormControlLabel value="minimal" control={<Radio size="small" />} label="Minimal (50%)" />
            <FormControlLabel value="standard" control={<Radio size="small" />} label="Standard (70%)" />
            <FormControlLabel value="exhaustive" control={<Radio size="small" />} label="Exhaustive (>80%)" />
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
              <FormControlLabel
                control={<Switch checked={parallelOptions.enableAssertions} onChange={handleParallelOptionChange('enableAssertions')} size="small" />}
                label={<Typography variant="body2">Smart Assertions</Typography>}
              />
            </Box>
            <Box sx={{ width: '48%' }}>
              <FormControlLabel
                control={<Switch checked={parallelOptions.enablePerformance} onChange={handleParallelOptionChange('enablePerformance')} size="small" />}
                label={<Typography variant="body2">Performance Tests</Typography>}
              />
            </Box>
            <Box sx={{ width: '48%' }}>
              <FormControlLabel
                control={<Switch checked={parallelOptions.enableOpenAPI} onChange={handleParallelOptionChange('enableOpenAPI')} size="small" />}
                label={<Typography variant="body2">OpenAPI Spec</Typography>}
              />
            </Box>
            <Box sx={{ width: '48%' }}>
              <FormControlLabel
                control={<Switch checked={parallelOptions.enableGraphQL} onChange={handleParallelOptionChange('enableGraphQL')} size="small" />}
                label={<Typography variant="body2">GraphQL Schema</Typography>}
              />
            </Box>
            <Box sx={{ width: '48%' }}>
              <FormControlLabel
                control={<Switch checked={parallelOptions.enableScenarios} onChange={handleParallelOptionChange('enableScenarios')} size="small" />}
                label={<Typography variant="body2">Test Scenarios</Typography>}
              />
            </Box>
            <Box sx={{ width: '48%' }}>
              <FormControlLabel
                control={<Switch checked={parallelOptions.enableDataDriven} onChange={handleParallelOptionChange('enableDataDriven')} size="small" />}
                label={<Typography variant="body2">Data-Driven Tests</Typography>}
              />
            </Box>
            <Box sx={{ width: '48%' }}>
              <FormControlLabel
                control={<Switch checked={parallelOptions.enableSecurity} onChange={handleParallelOptionChange('enableSecurity')} size="small" />}
                label={<Typography variant="body2">Security Tests</Typography>}
              />
            </Box>
            <Box sx={{ width: '48%' }}>
              <FormControlLabel
                control={<Switch checked={parallelOptions.enableAutoHealing} onChange={handleParallelOptionChange('enableAutoHealing')} size="small" />}
                label={<Typography variant="body2">Auto-Healing</Typography>}
              />
            </Box>
            <Box sx={{ width: '48%' }}>
              <FormControlLabel
                control={<Switch checked={parallelOptions.enableEnvironment} onChange={handleParallelOptionChange('enableEnvironment')} size="small" />}
                label={<Typography variant="body2">Environment Vars</Typography>}
              />
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

      {/* Generate Button */}
      <Button
        fullWidth
        variant="contained"
        startIcon={generationState.isGenerating ? <CircularProgress size={20} color="inherit" /> : <AutoAwesome />}
        onClick={parallelEnabled ? handleParallelGenerate : handleGenerate}
        disabled={generationState.isGenerating || (provider !== 'local' && !settings?.apiKeys[provider as keyof typeof settings.apiKeys])}
        sx={{ mb: 2 }}
      >
        {generationState.isGenerating
          ? 'Generating Tests...'
          : parallelEnabled
            ? `Generate All (${enabledParallelCount} features)`
            : `Generate Tests (${activeEndpointCount} endpoint${activeEndpointCount !== 1 ? 's' : ''})`}
      </Button>

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

    </Box>
  );
}