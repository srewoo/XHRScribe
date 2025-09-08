import React, { useState, useEffect } from 'react';
import {
  Container,
  Paper,
  Typography,
  Tabs,
  Tab,
  Box,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Switch,
  FormControlLabel,
  FormGroup,
  Alert,
  Snackbar,
  Divider,
  Chip,
  IconButton,
  InputAdornment,
} from '@mui/material';
import {
  Save,
  Visibility,
  VisibilityOff,
  Add,
  Delete,
  RestartAlt,
  Security,
  Code,
  FilterList,
  AttachMoney,
} from '@mui/icons-material';
import { Settings, AIProvider, TestFramework } from '@/types';
import { StorageService } from '@/services/StorageService';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 3 }}>{children}</Box>}
    </div>
  );
}

export default function OptionsApp() {
  const [tabValue, setTabValue] = useState(0);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [showApiKeys, setShowApiKeys] = useState<Record<string, boolean>>({});
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' });
  const [customPattern, setCustomPattern] = useState('');
  const [includeDomainsText, setIncludeDomainsText] = useState<string>('');
  const [excludeDomainsText, setExcludeDomainsText] = useState<string>('');
  const storageService = StorageService.getInstance();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const savedSettings = await storageService.getSettings();
      if (savedSettings) {
        setSettings(savedSettings);
        setIncludeDomainsText(savedSettings.filtering.includeDomains.join(', '));
        setExcludeDomainsText(savedSettings.filtering.excludeDomains.join(', '));
      } else {
        // Set defaults
        const defaults = getDefaultSettings();
        setSettings(defaults);
        setIncludeDomainsText(defaults.filtering.includeDomains.join(', '));
        setExcludeDomainsText(defaults.filtering.excludeDomains.join(', '));
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
      // If loading fails, try to reset corrupted data
      setSnackbar({ 
        open: true, 
        message: 'Error loading settings. Click "Reset Data" if the problem persists.', 
        severity: 'error' 
      });
      // Use defaults
      const defaults = getDefaultSettings();
      setSettings(defaults);
      setIncludeDomainsText(defaults.filtering.includeDomains.join(', '));
      setExcludeDomainsText(defaults.filtering.excludeDomains.join(', '));
    }
  };

  const getDefaultModelForProvider = (provider: string): string => {
    switch (provider) {
      case 'openai': return 'gpt-4o-mini';
      case 'anthropic': return 'claude-3-haiku-20240307';
      case 'gemini': return 'gemini-1.5-flash';
      case 'local': return 'llama-3.2';
      default: return 'gpt-4o-mini';
    }
  };

  const getDefaultSettings = (): Settings => ({
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
  });

  const handleSave = async () => {
    if (!settings) return;
    
    // Parse domain texts before saving
    const updatedSettings = {
      ...settings,
      filtering: {
        ...settings.filtering,
        includeDomains: includeDomainsText.split(',').map(d => d.trim()).filter(Boolean),
        excludeDomains: excludeDomainsText.split(',').map(d => d.trim()).filter(Boolean),
      },
    };
    
    try {
      await storageService.saveSettings(updatedSettings);
      setSnackbar({ open: true, message: 'Settings saved successfully!', severity: 'success' });
    } catch (error) {
      setSnackbar({ open: true, message: 'Failed to save settings', severity: 'error' });
    }
  };

  const handleReset = async () => {
    if (window.confirm('Are you sure you want to reset all settings to defaults?')) {
      const defaults = getDefaultSettings();
      setSettings(defaults);
      setIncludeDomainsText(defaults.filtering.includeDomains.join(', '));
      setExcludeDomainsText(defaults.filtering.excludeDomains.join(', '));
      setSnackbar({ open: true, message: 'Settings reset to defaults', severity: 'success' });
    }
  };

  const handleResetCorruptedData = async () => {
    if (window.confirm('This will clear all encrypted data (API keys and sessions) to fix corruption issues. Continue?')) {
      try {
        await storageService.resetCorruptedData();
        await loadSettings();
        setSnackbar({ open: true, message: 'Corrupted data has been cleared. Please re-enter your API keys.', severity: 'success' });
      } catch (error) {
        setSnackbar({ open: true, message: 'Failed to reset data', severity: 'error' });
      }
    }
  };

  const toggleApiKeyVisibility = (key: string) => {
    setShowApiKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const addCustomPattern = () => {
    if (!customPattern || !settings) return;
    
    try {
      new RegExp(customPattern); // Validate regex
      const newPatterns = [...settings.dataMasking.customPatterns, customPattern];
      setSettings({
        ...settings,
        dataMasking: { ...settings.dataMasking, customPatterns: newPatterns },
      });
      setCustomPattern('');
    } catch {
      setSnackbar({ open: true, message: 'Invalid regex pattern', severity: 'error' });
    }
  };

  const removeCustomPattern = (index: number) => {
    if (!settings) return;
    const newPatterns = settings.dataMasking.customPatterns.filter((_, i) => i !== index);
    setSettings({
      ...settings,
      dataMasking: { ...settings.dataMasking, customPatterns: newPatterns },
    });
  };

  if (!settings) {
    return <div>Loading...</div>;
  }

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper elevation={3}>
        {/* Header */}
        <Box sx={{ p: 3, bgcolor: 'primary.main', color: 'white' }}>
          <Typography variant="h4" gutterBottom>
            XHRScribe Settings
          </Typography>
          <Typography variant="body1">
            Configure your API test generation preferences
          </Typography>
        </Box>

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={(e, v) => setTabValue(v)}>
            <Tab icon={<Code />} label="AI Provider" />
            <Tab icon={<Security />} label="Privacy" />
            <Tab icon={<FilterList />} label="Filtering" />
            <Tab icon={<AttachMoney />} label="Advanced" />
          </Tabs>
        </Box>

        <Box sx={{ p: 3 }}>
          {/* AI Provider Tab */}
          <TabPanel value={tabValue} index={0}>
            <Typography variant="h6" gutterBottom>
              AI Provider Settings
            </Typography>
            
            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>AI Provider</InputLabel>
              <Select
                value={settings.aiProvider}
                onChange={(e) => {
                  const newProvider = e.target.value as AIProvider;
                  setSettings({ 
                    ...settings, 
                    aiProvider: newProvider,
                    aiModel: getDefaultModelForProvider(newProvider) as any
                  });
                }}
                label="AI Provider"
              >
                <MenuItem value="openai">OpenAI</MenuItem>
                <MenuItem value="anthropic">Anthropic Claude</MenuItem>
                <MenuItem value="gemini">Google Gemini</MenuItem>
                <MenuItem value="local">Local Model</MenuItem>
              </Select>
            </FormControl>

            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>AI Model</InputLabel>
              <Select
                value={settings.aiModel || getDefaultModelForProvider(settings.aiProvider)}
                onChange={(e) => setSettings({ ...settings, aiModel: e.target.value as any })}
                label="AI Model"
              >
                {settings.aiProvider === 'openai' && (
                  <>
                    <MenuItem value="gpt-4o">GPT-4o (Most Capable, Multimodal)</MenuItem>
                    <MenuItem value="gpt-4o-mini">GPT-4o Mini (Fast & Cheap)</MenuItem>
                    <MenuItem value="gpt-4-turbo">GPT-4 Turbo (Latest)</MenuItem>
                    <MenuItem value="gpt-3.5-turbo">GPT-3.5 Turbo (Fastest)</MenuItem>
                  </>
                )}
                {settings.aiProvider === 'anthropic' && (
                  <>
                    <MenuItem value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet (Latest)</MenuItem>
                    <MenuItem value="claude-3-opus-20240229">Claude 3 Opus (Most Capable)</MenuItem>
                    <MenuItem value="claude-3-sonnet-20240229">Claude 3 Sonnet (Balanced)</MenuItem>
                    <MenuItem value="claude-3-haiku-20240307">Claude 3 Haiku (Fast & Cheap)</MenuItem>
                  </>
                )}
                {settings.aiProvider === 'gemini' && (
                  <>
                    <MenuItem value="gemini-1.5-pro-latest">Gemini 1.5 Pro (2M Context)</MenuItem>
                    <MenuItem value="gemini-1.5-flash">Gemini 1.5 Flash (Fast)</MenuItem>
                    <MenuItem value="gemini-1.5-flash-8b">Gemini 1.5 Flash 8B (Smallest)</MenuItem>
                  </>
                )}
                {settings.aiProvider === 'local' && (
                  <>
                    <MenuItem value="llama-3.2">Llama 3.2 (Latest)</MenuItem>
                    <MenuItem value="codellama-70b">CodeLlama 70B (Code-Optimized)</MenuItem>
                    <MenuItem value="mixtral-8x7b">Mixtral 8x7B (MoE)</MenuItem>
                    <MenuItem value="deepseek-coder">DeepSeek Coder (Code-Specific)</MenuItem>
                  </>
                )}
              </Select>
            </FormControl>

            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>Default Test Framework</InputLabel>
              <Select
                value={settings.testFramework}
                onChange={(e) => setSettings({ ...settings, testFramework: e.target.value as TestFramework })}
                label="Default Test Framework"
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

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>
              API Keys
            </Typography>

            <TextField
              fullWidth
              label="OpenAI API Key"
              type={showApiKeys.openai ? 'text' : 'password'}
              value={settings.apiKeys.openai || ''}
              onChange={(e) => setSettings({
                ...settings,
                apiKeys: { ...settings.apiKeys, openai: e.target.value },
              })}
              sx={{ mb: 2 }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => toggleApiKeyVisibility('openai')}>
                      {showApiKeys.openai ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              label="Anthropic API Key"
              type={showApiKeys.anthropic ? 'text' : 'password'}
              value={settings.apiKeys.anthropic || ''}
              onChange={(e) => setSettings({
                ...settings,
                apiKeys: { ...settings.apiKeys, anthropic: e.target.value },
              })}
              sx={{ mb: 2 }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => toggleApiKeyVisibility('anthropic')}>
                      {showApiKeys.anthropic ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              label="Google Gemini API Key"
              type={showApiKeys.gemini ? 'text' : 'password'}
              value={settings.apiKeys.gemini || ''}
              onChange={(e) => setSettings({
                ...settings,
                apiKeys: { ...settings.apiKeys, gemini: e.target.value },
              })}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => toggleApiKeyVisibility('gemini')}>
                      {showApiKeys.gemini ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Alert severity="info" sx={{ mt: 2 }}>
              API keys are encrypted and stored securely. Never share your API keys.
            </Alert>
          </TabPanel>

          {/* Privacy Tab */}
          <TabPanel value={tabValue} index={1}>
            <Typography variant="h6" gutterBottom>
              Privacy & Security Settings
            </Typography>

            <FormControl fullWidth sx={{ mb: 3 }}>
              <InputLabel>Privacy Mode</InputLabel>
              <Select
                value={settings.privacyMode}
                onChange={(e) => setSettings({ ...settings, privacyMode: e.target.value as any })}
                label="Privacy Mode"
              >
                <MenuItem value="local">Local (No external API calls)</MenuItem>
                <MenuItem value="cloud">Cloud (Send masked data to AI)</MenuItem>
                <MenuItem value="hybrid">Hybrid (Smart routing)</MenuItem>
              </Select>
            </FormControl>

            <FormGroup>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.dataMasking.enabled}
                    onChange={(e) => setSettings({
                      ...settings,
                      dataMasking: { ...settings.dataMasking, enabled: e.target.checked },
                    })}
                  />
                }
                label="Enable Data Masking"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.dataMasking.maskPII}
                    onChange={(e) => setSettings({
                      ...settings,
                      dataMasking: { ...settings.dataMasking, maskPII: e.target.checked },
                    })}
                  />
                }
                label="Mask Personal Information (PII)"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.dataMasking.maskTokens}
                    onChange={(e) => setSettings({
                      ...settings,
                      dataMasking: { ...settings.dataMasking, maskTokens: e.target.checked },
                    })}
                  />
                }
                label="Mask API Tokens & Keys"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.dataMasking.maskEmails}
                    onChange={(e) => setSettings({
                      ...settings,
                      dataMasking: { ...settings.dataMasking, maskEmails: e.target.checked },
                    })}
                  />
                }
                label="Mask Email Addresses"
              />
            </FormGroup>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>
              Custom Masking Patterns
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                label="Add Regex Pattern"
                value={customPattern}
                onChange={(e) => setCustomPattern(e.target.value)}
                placeholder="e.g., \d{4}-\d{4}-\d{4}-\d{4}"
              />
              <Button
                variant="contained"
                onClick={addCustomPattern}
                startIcon={<Add />}
              >
                Add
              </Button>
            </Box>

            {settings.dataMasking.customPatterns.map((pattern, index) => (
              <Chip
                key={index}
                label={pattern}
                onDelete={() => removeCustomPattern(index)}
                sx={{ mr: 1, mb: 1 }}
              />
            ))}
          </TabPanel>

          {/* Filtering Tab */}
          <TabPanel value={tabValue} index={2}>
            <Typography variant="h6" gutterBottom>
              Request Filtering
            </Typography>

            <TextField
              fullWidth
              label="Include Domains (comma-separated)"
              value={includeDomainsText}
              onChange={(e) => setIncludeDomainsText(e.target.value)}
              sx={{ mb: 2 }}
              helperText="Leave empty to include all domains"
            />

            <TextField
              fullWidth
              label="Exclude Domains (comma-separated)"
              value={excludeDomainsText}
              onChange={(e) => setExcludeDomainsText(e.target.value)}
              sx={{ mb: 2 }}
              helperText="e.g., google.com, facebook.com"
            />

            <TextField
              fullWidth
              label="Minimum Duration (ms)"
              type="number"
              value={settings.filtering.minDuration}
              onChange={(e) => setSettings({
                ...settings,
                filtering: { ...settings.filtering, minDuration: parseInt(e.target.value) || 0 },
              })}
              sx={{ mb: 2 }}
            />

            <TextField
              fullWidth
              label="Maximum Request Size (bytes)"
              type="number"
              value={settings.filtering.maxRequestSize}
              onChange={(e) => setSettings({
                ...settings,
                filtering: { ...settings.filtering, maxRequestSize: parseInt(e.target.value) || 10485760 },
              })}
              sx={{ mb: 2 }}
            />
          </TabPanel>

          {/* Advanced Tab */}
          <TabPanel value={tabValue} index={3}>
            <Typography variant="h6" gutterBottom>
              Advanced Settings
            </Typography>

            <TextField
              fullWidth
              label="Max Tokens"
              type="number"
              value={settings.advanced.maxTokens}
              onChange={(e) => setSettings({
                ...settings,
                advanced: { ...settings.advanced, maxTokens: parseInt(e.target.value) || 4000 },
              })}
              sx={{ mb: 2 }}
            />

            <TextField
              fullWidth
              label="Temperature (0-1)"
              type="number"
              inputProps={{ step: 0.1, min: 0, max: 1 }}
              value={settings.advanced.temperature}
              onChange={(e) => setSettings({
                ...settings,
                advanced: { ...settings.advanced, temperature: parseFloat(e.target.value) || 0.7 },
              })}
              sx={{ mb: 2 }}
            />

            <TextField
              fullWidth
              label="Retry Attempts"
              type="number"
              value={settings.advanced.retryAttempts}
              onChange={(e) => setSettings({
                ...settings,
                advanced: { ...settings.advanced, retryAttempts: parseInt(e.target.value) || 3 },
              })}
              sx={{ mb: 2 }}
            />

            <TextField
              fullWidth
              label="Timeout (ms)"
              type="number"
              value={settings.advanced.timeout}
              onChange={(e) => setSettings({
                ...settings,
                advanced: { ...settings.advanced, timeout: parseInt(e.target.value) || 30000 },
              })}
              sx={{ mb: 2 }}
            />

            <FormControlLabel
              control={
                <Switch
                  checked={settings.advanced.cacheResponses}
                  onChange={(e) => setSettings({
                    ...settings,
                    advanced: { ...settings.advanced, cacheResponses: e.target.checked },
                  })}
                />
              }
              label="Cache AI Responses"
            />

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom color="error">
              Troubleshooting
            </Typography>
            
            <Alert severity="warning" sx={{ mb: 2 }}>
              If you're experiencing "Malformed UTF-8 data" errors or settings won't save, 
              click the button below to clear corrupted encrypted data.
            </Alert>
            
            <Button
              variant="outlined"
              color="error"
              startIcon={<Delete />}
              onClick={handleResetCorruptedData}
              sx={{ mb: 2 }}
            >
              Reset Corrupted Data
            </Button>
            
            <Typography variant="caption" color="text.secondary" display="block">
              This will clear all encrypted data (API keys and sessions). 
              You'll need to re-enter your API keys after resetting.
            </Typography>
          </TabPanel>

          {/* Action Buttons */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
            <Button
              variant="outlined"
              startIcon={<RestartAlt />}
              onClick={handleReset}
            >
              Reset to Defaults
            </Button>
            <Button
              variant="contained"
              startIcon={<Save />}
              onClick={handleSave}
            >
              Save Settings
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity as any} onClose={() => setSnackbar({ ...snackbar, open: false })}>
          {snackbar.message}
        </Alert>
      </Snackbar>

      {/* Footer with Help and Privacy Links */}
      <Box sx={{ mt: 4, pt: 3, borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="h6" gutterBottom>
          Help & Resources
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
          <Button
            variant="outlined"
            size="small"
            onClick={() => window.open('/privacy-policy.html', '_blank')}
          >
            Privacy Policy
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => window.open('https://github.com/[username]/XHRscribe/blob/main/docs/DEVELOPER_GUIDE.md', '_blank')}
          >
            Developer Guide
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => window.open('https://github.com/[username]/XHRscribe/blob/main/docs/FEATURES.md', '_blank')}
          >
            Feature Documentation
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => window.open('https://github.com/[username]/XHRscribe/issues', '_blank')}
          >
            Report Issue
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block">
          XHRScribe v{chrome.runtime.getManifest().version} - Transform your manual API testing into automated test suites with AI
        </Typography>
      </Box>
    </Container>
  );
}