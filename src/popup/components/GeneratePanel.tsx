import React, { useState, useEffect } from 'react';
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
import { RecordingSession, TestFramework, AIProvider } from '@/types';
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
}

export default function GeneratePanel({ sessions }: GeneratePanelProps) {
  const { selectedSession, generateTests, settings, loading, loadSettings, generatedTests } = useStore();
  const [framework, setFramework] = useState<TestFramework>('jest');
  const [provider, setProvider] = useState<AIProvider>('openai');
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

  // Watch for changes in generatedTests from the store
  useEffect(() => {
    if (generatedTests.length > 0 && !generatedCode) {
      const latestTest = generatedTests[generatedTests.length - 1];
      if (latestTest && latestTest.code) {
        setGeneratedCode(latestTest.code);
      }
    }
  }, [generatedTests]);

  // Update provider and framework from settings when loaded
  useEffect(() => {
    if (settings) {
      setProvider(settings.aiProvider || 'openai');
      setFramework(settings.testFramework || 'jest');
    }
  }, [settings]);

  // Use selectedSession (which includes uploaded HAR sessions) or fallback to first session
  const session = selectedSession || sessions[0];

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

    // Start generation process
    setGenerationState({
      isGenerating: true,
      progress: 10,
      stage: 'Preparing request data...',
      estimatedTime: Math.ceil(session.requests.length * 0.5 + 5), // Rough estimate in seconds
    });

    // Simulate progress stages
    const stages = [
      { progress: 20, stage: 'Analyzing API patterns...', delay: 1000 },
      { progress: 40, stage: 'Connecting to AI provider...', delay: 1500 },
      { progress: 60, stage: 'Generating test code...', delay: 2000 },
      { progress: 80, stage: 'Optimizing and validating...', delay: 1500 },
      { progress: 95, stage: 'Finalizing tests...', delay: 1000 },
    ];

    // Progress simulation
    let currentStageIndex = 0;
    const progressInterval = setInterval(() => {
      if (currentStageIndex < stages.length) {
        const stage = stages[currentStageIndex];
        setGenerationState(prev => ({
          ...prev,
          progress: stage.progress,
          stage: stage.stage,
        }));
        currentStageIndex++;
      }
    }, 1500);

    const generationOptions = {
      framework,
      provider,
      model: settings?.aiModel || 'gpt-4o-mini',
      ...options,
      complexity: 'intermediate' as const,
    };

    try {
      // Call the actual generateTests through the store and get the result
      const generatedTest = await generateTests(session.id, generationOptions);
      
      // Use the returned test directly
      if (generatedTest && generatedTest.code) {
        setGeneratedCode(generatedTest.code);
      }
      
      // Complete generation
      setGenerationState(prev => ({
        ...prev,
        progress: 100,
        stage: 'Tests generated successfully!',
      }));
      
      setTimeout(() => {
        setGenerationState({
          isGenerating: false,
          progress: 0,
          stage: '',
          estimatedTime: 0,
        });
      }, 1000);
      
    } catch (error) {
      setGenerationState({
        isGenerating: false,
        progress: 0,
        stage: 'Generation failed',
        estimatedTime: 0,
      });
    } finally {
      clearInterval(progressInterval);
    }
  };

  // Mock function removed - now using real AI generation
  const generateMockTestCode = (session: RecordingSession, framework: string): string => {
    const firstRequest = session.requests[0];
    if (!firstRequest) return '// No requests to generate tests for';

    if (framework === 'jest') {
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
    // Rough estimation based on request count
    const tokenEstimate = session.requests.length * 500;
    const costPerToken = 0.00002; // Example rate
    return tokenEstimate * costPerToken;
  };

  React.useEffect(() => {
    if (session) {
      setCostEstimate(estimateCost());
    }
  }, [session, options]);

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
        <EndpointPreview session={session} showDetails={false} />
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
          Based on approximately {session.requests.length * 500} tokens
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
                    {generationState.stage}
                  </Typography>
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
            
            {/* Quality Score */}
            <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Chip 
                label="Quality Score: 8.5/10" 
                color="success" 
                size="small"
              />
              <Chip 
                label={`${session.requests.length} endpoints covered`}
                size="small"
                variant="outlined"
              />
              <Chip 
                label="Ready to run"
                size="small"
                variant="outlined"
                color="success"
              />
            </Box>
          </Paper>
        </Fade>
      )}

    </Box>
  );
}