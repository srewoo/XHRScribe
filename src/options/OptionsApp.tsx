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
  CheckCircle,
  Cancel,
} from '@mui/icons-material';
import { CircularProgress } from '@mui/material';
import axios from 'axios';
import { Settings, AIProvider, TestFramework, AIModel } from '@/types';
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
  const [keyStatus, setKeyStatus] = useState<Record<string, 'idle' | 'loading' | 'valid' | 'invalid'>>({
    openai: 'idle', anthropic: 'idle', gemini: 'idle'
  });
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
        console.log('Loaded settings:', savedSettings);
        setSettings(savedSettings);
        setIncludeDomainsText(savedSettings.filtering.includeDomains.join(', '));
        setExcludeDomainsText(savedSettings.filtering.excludeDomains.join(', '));
      } else {
        // Set defaults
        const defaults = getDefaultSettings();
        console.log('Using default settings:', defaults);
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
      console.log('Using default settings after error:', defaults);
      setSettings(defaults);
      setIncludeDomainsText(defaults.filtering.includeDomains.join(', '));
      setExcludeDomainsText(defaults.filtering.excludeDomains.join(', '));
    }
  };



  const getDefaultSettings = (): Settings => ({
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

  const verifyApiKey = async (provider: string) => {
    const key = settings?.apiKeys?.[provider as keyof typeof settings.apiKeys];
    if (!key) return;

    setKeyStatus(prev => ({ ...prev, [provider]: 'loading' }));
    try {
      if (provider === 'openai') {
        await axios.get('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${key}` },
          timeout: 10000,
        });
      } else if (provider === 'anthropic') {
        await axios.post('https://api.anthropic.com/v1/messages', {
          model: 'claude-3-7-sonnet-20250219',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }, {
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          timeout: 10000,
        });
      } else if (provider === 'gemini') {
        await axios.get(`https://generativelanguage.googleapis.com/v1/models?key=${key}`, {
          timeout: 10000,
        });
      }
      setKeyStatus(prev => ({ ...prev, [provider]: 'valid' }));
    } catch {
      setKeyStatus(prev => ({ ...prev, [provider]: 'invalid' }));
    }
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
            <Tab icon={<Code />} label="API Keys" />
            <Tab icon={<Security />} label="Privacy" />
            <Tab icon={<FilterList />} label="Filtering" />
            <Tab icon={<AttachMoney />} label="Advanced" />
          </Tabs>
        </Box>

        <Box sx={{ p: 3 }}>
          {/* AI Provider Tab */}
          <TabPanel value={tabValue} index={0}>
            <Typography variant="h6" gutterBottom>
              AI Provider & Model
            </Typography>

            <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
              <FormControl fullWidth>
                <InputLabel>AI Provider</InputLabel>
                <Select
                  value={settings.aiProvider}
                  onChange={(e) => {
                    const newProvider = e.target.value as AIProvider;
                    const providerModels: Record<AIProvider, AIModel> = {
                      openai: 'gpt-4.1-mini',
                      anthropic: 'claude-4-5-sonnet',
                      gemini: 'gemini-2-5-flash',
                      local: 'llama-3.2',
                    };
                    setSettings({
                      ...settings,
                      aiProvider: newProvider,
                      aiModel: providerModels[newProvider],
                    });
                  }}
                  label="AI Provider"
                >
                  <MenuItem value="openai">OpenAI</MenuItem>
                  <MenuItem value="anthropic">Anthropic (Claude)</MenuItem>
                  <MenuItem value="gemini">Google Gemini</MenuItem>
                  <MenuItem value="local">Local Models</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>AI Model</InputLabel>
                <Select
                  value={settings.aiModel}
                  onChange={(e) => setSettings({ ...settings, aiModel: e.target.value as AIModel })}
                  label="AI Model"
                >
                  {settings.aiProvider === 'openai' && [
                    <MenuItem key="gpt-4.1" value="gpt-4.1">GPT-4.1 (Most Capable)</MenuItem>,
                    <MenuItem key="gpt-4.1-mini" value="gpt-4.1-mini">GPT-4.1 Mini (Fast & Cheap)</MenuItem>,
                  ]}
                  {settings.aiProvider === 'anthropic' && [
                    <MenuItem key="claude-4-5-opus" value="claude-4-5-opus">Claude 4.5 Opus (Most Capable)</MenuItem>,
                    <MenuItem key="claude-4-5-sonnet" value="claude-4-5-sonnet">Claude 4.5 Sonnet (Latest)</MenuItem>,
                    <MenuItem key="claude-4-sonnet" value="claude-4-sonnet">Claude 4 Sonnet</MenuItem>,
                    <MenuItem key="claude-3-7-sonnet" value="claude-3-7-sonnet">Claude 3.7 Sonnet</MenuItem>,
                  ]}
                  {settings.aiProvider === 'gemini' && [
                    <MenuItem key="gemini-2-5-pro" value="gemini-2-5-pro">Gemini 2.5 Pro</MenuItem>,
                    <MenuItem key="gemini-2-5-flash" value="gemini-2-5-flash">Gemini 2.5 Flash (Fast)</MenuItem>,
                  ]}
                  {settings.aiProvider === 'local' && [
                    <MenuItem key="llama-3.2" value="llama-3.2">Llama 3.2</MenuItem>,
                    <MenuItem key="deepseek-coder" value="deepseek-coder">DeepSeek Coder</MenuItem>,
                  ]}
                </Select>
              </FormControl>
            </Box>

            <Alert severity="info" sx={{ mb: 3 }}>
              This sets the default AI provider and model. You can override per-generation in the Generate tab.
            </Alert>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>
              Authentication Guide
            </Typography>


            <FormControl fullWidth sx={{ mb: 3 }}>
              <TextField
                label="Custom Authentication Guide (Optional)"
                multiline
                rows={6}
                value={settings.authGuide || ''}
                onChange={(e) => setSettings({ ...settings, authGuide: e.target.value })}
                placeholder="Provide specific instructions for authentication in your application. For example:

1. First call POST /api/login with username/password
2. Extract 'accessToken' from response.data.token
3. Use Bearer token in Authorization header for all subsequent requests
4. Token expires after 1 hour, refresh using /api/refresh endpoint
5. Use environment variables: TEST_USERNAME, TEST_PASSWORD"
                helperText="Optional: Provide custom authentication flow instructions to help the LLM generate more accurate test scripts for your specific API authentication requirements."
                sx={{ 
                  '& .MuiInputBase-root': {
                    fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                    fontSize: '12px'
                  }
                }}
              />
            </FormControl>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>
              API Keys
            </Typography>

            {(['openai', 'anthropic', 'gemini'] as const).map((provider) => {
              const labels: Record<string, string> = { openai: 'OpenAI API Key', anthropic: 'Anthropic API Key', gemini: 'Google Gemini API Key' };
              return (
                <TextField
                  key={provider}
                  fullWidth
                  label={labels[provider]}
                  type={showApiKeys[provider] ? 'text' : 'password'}
                  value={settings.apiKeys[provider] || ''}
                  onChange={(e) => {
                    setSettings({ ...settings, apiKeys: { ...settings.apiKeys, [provider]: e.target.value } });
                    setKeyStatus(prev => ({ ...prev, [provider]: 'idle' }));
                  }}
                  sx={{ mb: 2 }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        {keyStatus[provider] === 'loading' ? (
                          <CircularProgress size={20} sx={{ mr: 1 }} />
                        ) : keyStatus[provider] === 'valid' ? (
                          <CheckCircle sx={{ color: 'success.main', mr: 1 }} />
                        ) : keyStatus[provider] === 'invalid' ? (
                          <Cancel sx={{ color: 'error.main', mr: 1 }} />
                        ) : settings.apiKeys[provider] ? (
                          <Button
                            size="small"
                            onClick={() => verifyApiKey(provider)}
                            sx={{ mr: 0.5, minWidth: 'auto', textTransform: 'none', fontSize: '0.75rem' }}
                          >
                            Verify
                          </Button>
                        ) : null}
                        <IconButton onClick={() => toggleApiKeyVisibility(provider)}>
                          {showApiKeys[provider] ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                />
              );
            })}

            <Alert severity="info" sx={{ mt: 2 }}>
              API keys are encrypted and stored securely. Never share your API keys.
            </Alert>

          </TabPanel>

          {/* Privacy Tab */}
          <TabPanel value={tabValue} index={1}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Typography variant="h6">
                Privacy & Security Settings
              </Typography>
            </Box>

            <Alert severity="info" sx={{ mb: 2 }}>
              Data masking automatically protects sensitive information in captured requests before storage and AI processing.
            </Alert>

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
                label="Enable Data Masking Integration"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4, mb: 1 }}>
                Master switch to enable/disable all data masking features
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.dataMasking.maskPII}
                    onChange={(e) => setSettings({
                      ...settings,
                      dataMasking: { ...settings.dataMasking, maskPII: e.target.checked },
                    })}
                    disabled={!settings.dataMasking.enabled}
                  />
                }
                label="Mask Personal Information (PII)"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4, mb: 1 }}>
                Masks phone numbers, SSN, credit cards, and IP addresses
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.dataMasking.maskTokens}
                    onChange={(e) => setSettings({
                      ...settings,
                      dataMasking: { ...settings.dataMasking, maskTokens: e.target.checked },
                    })}
                    disabled={!settings.dataMasking.enabled}
                  />
                }
                label="Mask API Tokens & Keys"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4, mb: 1 }}>
                Masks API keys, passwords, JWT tokens, and auth headers
              </Typography>

              <FormControlLabel
                control={
                  <Switch
                    checked={settings.dataMasking.maskEmails}
                    onChange={(e) => setSettings({
                      ...settings,
                      dataMasking: { ...settings.dataMasking, maskEmails: e.target.checked },
                    })}
                    disabled={!settings.dataMasking.enabled}
                  />
                }
                label="Mask Email Addresses"
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 4, mb: 1 }}>
                Replaces email addresses with ***EMAIL***
              </Typography>
            </FormGroup>

            <Divider sx={{ my: 3 }} />

            <Typography variant="h6" gutterBottom>
              Custom Masking Patterns
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Add custom regex patterns to mask specific data formats in your requests
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
              <TextField
                fullWidth
                label="Add Regex Pattern"
                value={customPattern}
                onChange={(e) => setCustomPattern(e.target.value)}
                placeholder="e.g., \d{4}-\d{4}-\d{4}-\d{4}"
                disabled={!settings.dataMasking.enabled}
                helperText="Enter a valid JavaScript regex pattern"
              />
              <Button
                variant="contained"
                onClick={addCustomPattern}
                startIcon={<Add />}
                disabled={!settings.dataMasking.enabled || !customPattern.trim()}
              >
                Add
              </Button>
            </Box>

            {settings.dataMasking.customPatterns.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="subtitle2" gutterBottom>Active Patterns:</Typography>
                {settings.dataMasking.customPatterns.map((pattern, index) => (
                  <Chip
                    key={index}
                    label={pattern}
                    onDelete={() => removeCustomPattern(index)}
                    sx={{ mr: 1, mb: 1 }}
                    color="primary"
                    variant="outlined"
                  />
                ))}
              </Box>
            )}
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
            onClick={() => window.open('https://raw.githubusercontent.com/srewoo/XHRScribe/main/help.html', '_blank')}
          >
            Help & User Guide
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => window.open('https://github.com/srewoo/XHRScribe/blob/main/docs/FEATURES.md', '_blank')}
          >
            Feature Documentation
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block">
          XHRScribe v{chrome.runtime.getManifest().version} - Turn traffic into tests
        </Typography>
      </Box>
    </Container>
  );
}