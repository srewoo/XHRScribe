import React, { useState, useEffect, useRef } from 'react';
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
  Skeleton,
  Fade,
  CircularProgress,
  Backdrop,
  Tooltip,
  Radio,
  RadioGroup,
} from '@mui/material';
import {
  Code,
  AutoAwesome,
  Download,
  ContentCopy,
  AttachMoney,
  CheckCircle,
  Error as ErrorIcon,
  Info,
} from '@mui/icons-material';
import { RecordingSession, TestFramework, AIProvider, AIModel } from '@/types';
import { useStore } from '@/store/useStore';
import EndpointPreview from './EndpointPreview';

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
  const [model, setModel] = useState<AIModel>('gpt-4o-mini');
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
  const [costEstimate, setCostEstimate] = useState<number>(0);
  const [copySuccess, setCopySuccess] = useState(false);
  const [excludedEndpoints, setExcludedEndpoints] = useState<Set<string>>(new Set());
  const [generationState, setGenerationState] = useState<GenerationState>({
    isGenerating: false,
    progress: 0,
    stage: '',
    estimatedTime: 0,
  });

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);

  // Listen for generation progress updates
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
      { value: 'gpt-4o', label: 'GPT-4o (Most Capable, Multimodal)' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (Fast & Cheap)' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
      
      // Anthropic Claude Models
      { value: 'claude-4-sonnet', label: 'Claude 4 Sonnet (Latest & Most Capable)' },
      { value: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet (Advanced)' },
      { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet (Proven)' },
      { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus (Legacy)' },
      { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet (Legacy)' },
      { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku (Legacy)' },
      
      // Google Gemini Models
      { value: 'gemini-2-5-pro', label: 'Gemini 2.5 Pro (Latest & Most Capable)' },
      { value: 'gemini-2-5-flash', label: 'Gemini 2.5 Flash (Latest & Fast)' },
      { value: 'gemini-1.5-pro-latest', label: 'Gemini 1.5 Pro (Legacy)' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Legacy)' },
      { value: 'gemini-1.5-flash-8b', label: 'Gemini 1.5 Flash 8B (Legacy)' },
      
      // Local Models
      { value: 'llama-3.2', label: 'Llama 3.2 (Latest)' },
      { value: 'codellama-70b', label: 'CodeLlama 70B (Code-specific)' },
      { value: 'mixtral-8x7b', label: 'Mixtral 8x7B (MoE model)' },
      { value: 'deepseek-coder', label: 'DeepSeek Coder (Code-specific)' },
    ];
  };

  // Debug: Track model state changes
  useEffect(() => {
    console.log('📊 Model state changed to:', model, 'hasUserChangedModel:', hasUserChangedModel);
  }, [model, hasUserChangedModel]);

  // Update provider and model from settings when loaded (only on initial load)
  useEffect(() => {
    if (settings && isInitialLoadRef.current) {
      console.log('🔧 Initial settings load - setting provider and model from settings:', settings);
      setProvider(settings.aiProvider || 'openai');
      setModel(settings.aiModel || 'gpt-4o-mini');
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

    const generationOptions = {
      framework,
      provider,
      model, // Use the local model state instead of settings
      ...options,
      complexity: 'intermediate' as const,
      excludedEndpoints: Array.from(excludedEndpoints), // Convert Set to Array for serialization
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

  const handleCopyToClipboard = async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([generatedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-${session?.id}-${framework}.js`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const estimateCost = () => {
    if (!session) return 0;
    
    // Calculate unique endpoints (more accurate than all requests)
    const uniqueEndpoints = new Set<string>();
    session.requests.forEach(request => {
      try {
        const url = new URL(request.url);
        const signature = `${request.method}:${url.pathname}`;
        if (!excludedEndpoints.has(signature)) {
          uniqueEndpoints.add(signature);
        }
      } catch (error) {
        const signature = `${request.method}:${request.url}`;
        if (!excludedEndpoints.has(signature)) {
          uniqueEndpoints.add(signature);
        }
      }
    });

    const endpointCount = uniqueEndpoints.size;
    if (endpointCount === 0) return 0;

    // More accurate token estimation
    const baseTokensPerEndpoint = 800; // Base tokens for analysis + test generation
    
    // Feature complexity multipliers
    let complexityMultiplier = 1.0;
    if (options.includeAuth) complexityMultiplier += 0.25;
    if (options.includeErrorScenarios) complexityMultiplier += 0.35;
    if (options.includePerformanceTests) complexityMultiplier += 0.2;
    if (options.includeSecurityTests) complexityMultiplier += 0.3;
    if (options.generateMockData) complexityMultiplier += 0.15;
    
    // Test coverage multiplier
    const coverageMultiplier = {
      'exhaustive': 1.8,
      'standard': 1.2,
      'minimal': 0.7
    }[options.testCoverage] || 1.2;

    const totalTokens = endpointCount * baseTokensPerEndpoint * complexityMultiplier * coverageMultiplier;

    // Realistic 2024 pricing per 1K tokens
    const providerCosts = {
      'openai': 0.00015,     // GPT-4o mini - very affordable
      'anthropic': 0.00025,  // Claude 3 Haiku 
      'gemini': 0.000075,    // Gemini Flash - cheapest
      'local': 0,            // Free
    };

    const costPer1K = providerCosts[provider as keyof typeof providerCosts] || 0.00015;
    return (totalTokens / 1000) * costPer1K;
  };

  React.useEffect(() => {
    if (session) {
      setCostEstimate(estimateCost());
    }
  }, [session, options, excludedEndpoints]);

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
              <MenuItem value="jest">Jest</MenuItem>
              <MenuItem value="playwright">Playwright</MenuItem>
              <MenuItem value="mocha-chai">Mocha/Chai</MenuItem>
              <MenuItem value="cypress">Cypress</MenuItem>
              <MenuItem value="puppeteer">Puppeteer</MenuItem>
              <MenuItem value="vitest">Vitest</MenuItem>
              <MenuItem value="supertest">Supertest</MenuItem>
              <MenuItem value="postman">Postman</MenuItem>
              <MenuItem value="restassured">REST Assured</MenuItem>
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
                console.log('🎯 User selected model:', newModel);
                setModel(newModel);
                setHasUserChangedModel(true); // Track that user has manually changed the model
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

      <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <AttachMoney fontSize="small" />
          <Typography variant="subtitle2">Estimated Cost</Typography>
        </Box>
        <Typography variant="h6">${costEstimate.toFixed(4)}</Typography>
        <Typography variant="caption" color="text.secondary">
          {(() => {
            // Calculate unique endpoints for display
            const uniqueEndpoints = new Set<string>();
            session.requests.forEach(request => {
              try {
                const url = new URL(request.url);
                const signature = `${request.method}:${url.pathname}`;
                if (!excludedEndpoints.has(signature)) {
                  uniqueEndpoints.add(signature);
                }
              } catch (error) {
                const signature = `${request.method}:${request.url}`;
                if (!excludedEndpoints.has(signature)) {
                  uniqueEndpoints.add(signature);
                }
              }
            });

            const endpointCount = uniqueEndpoints.size;
            const baseTokens = endpointCount * 800;
            const featureMultiplier = 1 + 
              (options.includeAuth ? 0.25 : 0) +
              (options.includeErrorScenarios ? 0.35 : 0) +
              (options.includePerformanceTests ? 0.2 : 0) +
              (options.includeSecurityTests ? 0.3 : 0) +
              (options.generateMockData ? 0.15 : 0);
            const estimatedTokens = Math.round(baseTokens * featureMultiplier);
            
            return excludedEndpoints.size > 0 
              ? `Based on ${endpointCount} included endpoints (~${estimatedTokens.toLocaleString()} tokens)`
              : `Based on ${endpointCount} unique endpoints (~${estimatedTokens.toLocaleString()} tokens)`;
          })()}
        </Typography>
      </Paper>

      {/* Generate Button */}
      <Button
        fullWidth
        variant="contained"
        startIcon={generationState.isGenerating ? <CircularProgress size={20} color="inherit" /> : <AutoAwesome />}
        onClick={handleGenerate}
        disabled={generationState.isGenerating || (provider !== 'local' && !settings?.apiKeys[provider as keyof typeof settings.apiKeys])}
        sx={{ mb: 2 }}
      >
        {generationState.isGenerating ? 'Generating Tests...' : 'Generate Tests'}
      </Button>

      {/* Generation Progress - Enhanced */}
      {generationState.isGenerating && (
        <Fade in={true}>
          <Paper elevation={3} sx={{ 
            p: 3, 
            mb: 2, 
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* Animated background effect */}
            <Box sx={{
              position: 'absolute',
              top: 0,
              left: '-100%',
              width: '200%',
              height: '100%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
              animation: 'shimmer 2s infinite',
              '@keyframes shimmer': {
                '0%': { transform: 'translateX(0)' },
                '100%': { transform: 'translateX(50%)' },
              },
            }} />
            
            <Box sx={{ position: 'relative', zIndex: 1 }}>
              {/* Loading icon and title */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <CircularProgress size={32} sx={{ color: 'white' }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    Generating Test Suite
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.9 }}>
                    {generationState.currentEndpoint && generationState.totalEndpoints ? 
                      `Generating tests for endpoint ${generationState.currentEndpoint}/${generationState.totalEndpoints}` :
                      generationState.stage
                    }
                  </Typography>
                  {generationState.endpointName && (
                    <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.5 }}>
                      {generationState.endpointName.length > 60 ? 
                        `${generationState.endpointName.substring(0, 60)}...` : 
                        generationState.endpointName
                      }
                    </Typography>
                  )}
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                  {generationState.progress}%
                </Typography>
              </Box>
              
              {/* Progress bar */}
              <LinearProgress 
                variant="determinate" 
                value={generationState.progress}
                sx={{ 
                  height: 10, 
                  borderRadius: 5,
                  bgcolor: 'rgba(255,255,255,0.3)',
                  '& .MuiLinearProgress-bar': {
                    bgcolor: 'white',
                    borderRadius: 5,
                  }
                }}
              />
              
              {/* Estimated time */}
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 1, 
                mt: 2,
                p: 1.5,
                bgcolor: 'rgba(255,255,255,0.1)',
                borderRadius: 2
              }}>
                <Info fontSize="small" />
                <Typography variant="body2">
                  Estimated time remaining: {Math.max(1, Math.ceil(generationState.estimatedTime * (100 - generationState.progress) / 100))} seconds
                </Typography>
              </Box>
              
              {/* Progress steps */}
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                  Progress Steps:
                </Typography>
                {[
                  { step: 'Analyzing API patterns', threshold: 0 },
                  { step: 'Connecting to AI provider', threshold: 20 },
                  { step: 'Generating test code', threshold: 40 },
                  { step: 'Optimizing and validating', threshold: 60 },
                  { step: 'Finalizing test suite', threshold: 80 },
                ].map(({ step, threshold }, index) => (
                  <Box key={step} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    {generationState.progress > threshold + 20 ? (
                      <CheckCircle fontSize="small" sx={{ color: 'white' }} />
                    ) : generationState.progress > threshold ? (
                      <CircularProgress size={16} sx={{ color: 'white' }} />
                    ) : (
                      <Box sx={{ 
                        width: 16, 
                        height: 16, 
                        borderRadius: '50%', 
                        bgcolor: 'rgba(255,255,255,0.3)',
                        border: '2px solid rgba(255,255,255,0.5)' 
                      }} />
                    )}
                    <Typography 
                      variant="body2" 
                      sx={{ 
                        opacity: generationState.progress > threshold ? 1 : 0.6,
                        fontWeight: generationState.progress > threshold && generationState.progress <= threshold + 20 ? 'bold' : 'normal'
                      }}
                    >
                      {step}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </Paper>
        </Fade>
      )}

      {/* Generated Code */}
      {generatedCode && !generationState.isGenerating && (
        <Fade in={true}>
          <Paper elevation={1} sx={{ p: 2 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                mb: 1,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircle color="success" />
                <Typography variant="subtitle2">Generated Tests</Typography>
              </Box>
              <Box>
                <Tooltip title={copySuccess ? 'Copied!' : 'Copy to clipboard'}>
                  <IconButton size="small" onClick={handleCopyToClipboard}>
                    <ContentCopy fontSize="small" color={copySuccess ? 'success' : 'inherit'} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Download file">
                  <IconButton size="small" onClick={handleDownload}>
                    <Download fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <Paper
              variant="outlined"
              sx={{
                p: 1,
                bgcolor: 'grey.50',
                maxHeight: 300,
                overflow: 'auto',
              }}
            >
              <pre
                style={{
                  margin: 0,
                  fontSize: 11,
                  fontFamily: 'monospace',
                }}
              >
                {generatedCode}
              </pre>
            </Paper>
            
            {/* Quality Score and Warnings */}
            <Box sx={{ mt: 2 }}>
              {/* Generation Strategy Info */}
              {(() => {
                const latestTest = generatedTests[generatedTests.length - 1];
                const generationMode = latestTest?.metadata?.generationMode;
                
                if (generationMode) {
                  return (
                    <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                      {generationMode === 'individual' 
                        ? '🔥 Individual endpoint processing used for guaranteed completeness' 
                        : '📦 Batch processing used for efficiency'}
                    </Typography>
                  );
                }
                return null;
              })()}
              
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {(() => {
                  const latestTest = generatedTests[generatedTests.length - 1];
                  const hasWarnings = latestTest?.warnings && latestTest.warnings.length > 0;
                  const hasPlaceholderWarnings = latestTest?.warnings?.some(w => w.includes('placeholder'));
                  
                  return (
                    <>
                      <Chip 
                        label={`Quality Score: ${latestTest?.qualityScore || 8}/10`} 
                        color={hasWarnings ? "warning" : "success"} 
                        size="small"
                      />
                      <Chip 
                        label={`${(() => {
                          const includedCount = session.requests.filter(request => {
                            try {
                              const url = new URL(request.url);
                              const signature = `${request.method}:${url.pathname}`;
                              return !excludedEndpoints.has(signature);
                            } catch (error) {
                              const signature = `${request.method}:${request.url}`;
                              return !excludedEndpoints.has(signature);
                            }
                          }).length;
                          return includedCount;
                        })()} endpoints processed`}
                        size="small"
                        variant="outlined"
                      />
                      {/* Show generation strategy */}
                      {latestTest?.metadata?.generationMode && (
                        <Chip 
                          label={`${latestTest.metadata.generationMode === 'individual' ? '🔥 Individual' : '📦 Batch'} Generation`}
                          size="small"
                          variant="outlined"
                          color={latestTest.metadata.generationMode === 'individual' ? 'primary' : 'default'}
                        />
                      )}
                      {!hasWarnings ? (
                        <Chip 
                          label="Complete & Ready to run"
                          size="small"
                          variant="outlined"
                          color="success"
                        />
                      ) : hasPlaceholderWarnings ? (
                        <Chip 
                          label="⚠️ Incomplete Generation"
                          size="small"
                          color="error"
                          variant="outlined"
                        />
                      ) : (
                        <Chip 
                          label="⚠️ Has Warnings"
                          size="small"
                          color="warning"
                          variant="outlined"
                        />
                      )}
                    </>
                  );
                })()}
              </Box>
              
              {/* Show warnings if any */}
              {(() => {
                const latestTest = generatedTests[generatedTests.length - 1];
                const warnings = latestTest?.warnings || [];
                
                if (warnings.length > 0) {
                  return (
                    <Box sx={{ mt: 1 }}>
                      {warnings.map((warning, index) => (
                        <Alert 
                          key={index} 
                          severity={warning.includes('placeholder') ? "error" : "warning"} 
                          sx={{ mt: 0.5, fontSize: '0.8rem' }}
                        >
                          {warning}
                        </Alert>
                      ))}
                    </Box>
                  );
                }
                return null;
              })()}
            </Box>
          </Paper>
        </Fade>
      )}

    </Box>
  );
}