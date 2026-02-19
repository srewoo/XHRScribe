import React, { useState, useEffect } from 'react';
import { keyframes } from '@mui/system';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tabs,
  Tab,
  Alert,
  Chip,
  Tooltip,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  LinearProgress,
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  Settings,
  Code,
  Help,
  Close,
  Minimize,
  OpenInFull,
} from '@mui/icons-material';
import { RecordingSession, NetworkRequest } from '@/types';
import RecordingPanel from './components/RecordingPanel';
import SessionList from './components/SessionList';
import RequestList from './components/RequestList';
import GeneratePanel from './components/GeneratePanel';
import ImportPanel from './components/ImportPanel';
import SessionDiffPanel from './components/SessionDiffPanel';
import { useStore } from '@/store/useStore';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const pulseAnimation = keyframes`
  0% { opacity: 1; }
  50% { opacity: 0.5; }
  100% { opacity: 1; }
`;

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel(props: TabPanelProps) {
  const { children, value, index, ...other } = props;
  return (
    <div hidden={value !== index} {...other}>
      {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
    </div>
  );
}

export default function App() {
  const [tabValue, setTabValue] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [helpMenuAnchor, setHelpMenuAnchor] = useState<null | HTMLElement>(null);
  const {
    recording,
    currentSession,
    sessions,
    loading,
    error,
    startRecording,
    stopRecording,
    loadSessions,
    clearError,
  } = useStore();

  // Send postMessage to parent (content script) for panel control
  const sendPanelMessage = (type: string, data?: Record<string, unknown>) => {
    window.parent.postMessage({ type, ...data }, '*');
  };

  useEffect(() => {
    // Load initial data
    loadSessions();
    checkRecordingStatus();

    // Listen for tab switch events
    const handleSwitchToGenerate = () => {
      setTabValue(3); // Switch to Generate tab
    };

    window.addEventListener('switchToGenerate', handleSwitchToGenerate);
    return () => {
      window.removeEventListener('switchToGenerate', handleSwitchToGenerate);
    };
  }, []);

  const checkRecordingStatus = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab.id) {
        // Use a more robust approach with retry logic
        await waitForBackgroundAndCheck(tab.id, 3); // Try 3 times with delays
      }
    } catch (error) {
      console.error('Failed to check recording status:', error);
    }
  };

  const waitForBackgroundAndCheck = async (tabId: number, maxRetries: number) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // First, ping the background to ensure it's ready
        const pingResponse = await chrome.runtime.sendMessage({ type: 'PING' });
        
        if (pingResponse?.success) {
          // Background is ready, now check recording status
          const response = await chrome.runtime.sendMessage({
            type: 'GET_STATUS',
            tabId: tabId,
          });
          
          if (response && response.success && response.status?.recording) {
            useStore.setState({ 
              recording: true, 
              currentSession: response.status.session 
            });
          }
          return; // Success, exit retry loop
        }
      } catch (error) {
        console.log(`Background not ready yet (attempt ${attempt}/${maxRetries})`);
        
        if (attempt < maxRetries) {
          // Wait before retrying, with exponential backoff
          await new Promise(resolve => setTimeout(resolve, attempt * 300));
        } else {
          console.warn('Background script failed to respond after multiple attempts');
        }
      }
    }
  };

  const handleStartRecording = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await startRecording(tab.id);
      // Auto-minimize with recording indicator
      sendPanelMessage('XHRSCRIBE_RECORDING', { recording: true });
    }
  };

  const handleStopRecording = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await stopRecording(tab.id);
      sendPanelMessage('XHRSCRIBE_RECORDING', { recording: false });
      setTabValue(1); // Switch to sessions tab
    }
  };

  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const handleTabChange = (event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
  };

  const handleHelpMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setHelpMenuAnchor(event.currentTarget);
  };

  const handleHelpMenuClose = () => {
    setHelpMenuAnchor(null);
  };

  const handleOpenPrivacyPolicy = () => {
    window.open(chrome.runtime.getURL('privacy-policy.html'), '_blank');
    handleHelpMenuClose();
  };

  const handleOpenHelp = () => {
    window.open(chrome.runtime.getURL('help.html'), '_blank');
    handleHelpMenuClose();
  };

  return (
    <Box sx={{ width: '100%', height: '100vh', bgcolor: 'background.default', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Paper elevation={0} sx={{ p: 1.5, borderRadius: 0, bgcolor: 'primary.main', color: 'white', flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Code sx={{ color: 'white' }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
              <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1.2, color: 'white', fontSize: '1rem' }}>
                XHRScribe
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontSize: '0.65rem',
                  fontStyle: 'italic',
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                  lineHeight: 1,
                  mt: -0.3,
                  color: 'rgba(255,255,255,0.7)'
                }}
              >
                Turn traffic into tests
              </Typography>
            </Box>
            {recording && (
              <Chip
                label="Recording"
                color="error"
                size="small"
                sx={{ animation: `${pulseAnimation} 1.5s infinite` }}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            <Tooltip title="Help & Support">
              <IconButton size="small" onClick={handleHelpMenuOpen} sx={{ color: 'white' }}>
                <Help sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Settings">
              <IconButton size="small" onClick={handleOpenOptions} sx={{ color: 'white' }}>
                <Settings sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={isMaximized ? 'Restore' : 'Maximize'}>
              <IconButton
                size="small"
                onClick={() => { setIsMaximized(!isMaximized); sendPanelMessage('XHRSCRIBE_MAXIMIZE'); }}
                sx={{ color: 'white' }}
              >
                <OpenInFull sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Minimize">
              <IconButton size="small" onClick={() => sendPanelMessage('XHRSCRIBE_MINIMIZE')} sx={{ color: 'white' }}>
                <Minimize sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Close">
              <IconButton size="small" onClick={() => sendPanelMessage('XHRSCRIBE_CLOSE')} sx={{ color: 'white' }}>
                <Close sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Paper>

      <Divider />

      {/* Error Alert */}
      {error && (
        <Alert severity="error" onClose={clearError} sx={{ m: 2, flexShrink: 0 }}>
          {error}
        </Alert>
      )}

      {/* Main Content */}
      <Box sx={{ px: 2, flex: 1, overflow: 'auto' }}>
        {/* Recording Controls */}
        <RecordingPanel
          recording={recording}
          currentSession={currentSession}
          onStart={handleStartRecording}
          onStop={handleStopRecording}
          loading={loading}
        />

        {/* Tabs */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', mt: 2 }}>
          <Tabs value={tabValue} onChange={handleTabChange}>
            <Tab label="Current" disabled={!recording && !currentSession} />
            <Tab label={`Sessions (${sessions.length})`} />
            <Tab label="Import" />
            <Tab label="Generate" disabled={sessions.length === 0} />
            <Tab label="Diff" disabled={sessions.length < 2} />
          </Tabs>
        </Box>

        {/* Tab Panels */}
        <TabPanel value={tabValue} index={0}>
          {currentSession ? (
            <RequestList requests={currentSession.requests} />
          ) : (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography color="text.secondary">
                No active recording session
              </Typography>
            </Box>
          )}
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <SessionList sessions={sessions} />
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <ImportPanel />
        </TabPanel>

        <TabPanel value={tabValue} index={3}>
          <GeneratePanel sessions={sessions} />
        </TabPanel>

        <TabPanel value={tabValue} index={4}>
          <SessionDiffPanel sessions={sessions} />
        </TabPanel>
      </Box>

      {/* Subtle loading indicator - non-blocking */}
      {loading && (
        <LinearProgress
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 9999,
            height: 2,
          }}
        />
      )}

      {/* Help Menu */}
      <Menu
        anchorEl={helpMenuAnchor}
        open={Boolean(helpMenuAnchor)}
        onClose={handleHelpMenuClose}
        PaperProps={{
          sx: { width: 220 }
        }}
      >
        <MenuItem onClick={handleOpenHelp}>
          <ListItemIcon>
            <Help fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Help & User Guide" />
        </MenuItem>
        <MenuItem onClick={handleOpenPrivacyPolicy}>
          <ListItemIcon>
            <Settings fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Privacy Policy" />
        </MenuItem>
        <Divider />
        <MenuItem disabled>
          <ListItemText 
            primary={`Version ${chrome.runtime.getManifest().version}`}
            primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
          />
        </MenuItem>
      </Menu>

    </Box>
  );
}