import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Tabs,
  Tab,
  Alert,
  CircularProgress,
  Chip,
  Tooltip,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  Settings,
  Download,
  Delete,
  ContentCopy,
  Code,
  Refresh,
  FilterList,
  Help,
  MoreVert,
} from '@mui/icons-material';
import { RecordingSession, NetworkRequest } from '@/types';
import RecordingPanel from './components/RecordingPanel';
import SessionList from './components/SessionList';
import RequestList from './components/RequestList';
import GeneratePanel from './components/GeneratePanel';
import ImportPanel from './components/ImportPanel';
import { useStore } from '@/store/useStore';

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

  useEffect(() => {
    // Load initial data
    loadSessions();
    checkRecordingStatus();
    
    // Listen for tab switch events
    const handleSwitchToGenerate = () => {
      setTabValue(2); // Switch to Generate tab
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
        // Check if the background script is responding
        try {
          const response = await chrome.runtime.sendMessage({
            type: 'GET_STATUS',
            tabId: tab.id,
          });
          if (response && response.success && response.status.recording) {
            useStore.setState({ 
              recording: true, 
              currentSession: response.status.session 
            });
          }
        } catch (messageError) {
          // Background script not ready or not responding
          console.log('Background script not ready yet');
          // Try again in a moment
          setTimeout(() => {
            chrome.runtime.sendMessage({
              type: 'GET_STATUS',
              tabId: tab.id,
            }).then(response => {
              if (response && response.success && response.status.recording) {
                useStore.setState({ 
                  recording: true, 
                  currentSession: response.status.session 
                });
              }
            }).catch(() => {
              // Silent fail - background not ready
            });
          }, 500);
        }
      }
    } catch (error) {
      console.error('Failed to check recording status:', error);
    }
  };

  const handleStartRecording = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await startRecording(tab.id);
    }
  };

  const handleStopRecording = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await stopRecording(tab.id);
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
    <Box sx={{ width: 400, minHeight: 500, bgcolor: 'background.default' }}>
      {/* Header */}
      <Paper elevation={0} sx={{ p: 2, borderRadius: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Code color="primary" />
            <Typography variant="h6" fontWeight="bold">
              XHRScribe
            </Typography>
            {recording && (
              <Chip
                label="Recording"
                color="error"
                size="small"
                sx={{ animation: 'pulse 1.5s infinite' }}
              />
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Help & Support">
              <IconButton size="small" onClick={handleHelpMenuOpen}>
                <Help />
              </IconButton>
            </Tooltip>
            <Tooltip title="Settings">
              <IconButton size="small" onClick={handleOpenOptions}>
                <Settings />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Paper>

      <Divider />

      {/* Error Alert */}
      {error && (
        <Alert severity="error" onClose={clearError} sx={{ m: 2 }}>
          {error}
        </Alert>
      )}

      {/* Main Content */}
      <Box sx={{ px: 2 }}>
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
      </Box>

      {/* Loading Overlay */}
      {loading && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <CircularProgress color="primary" />
        </Box>
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

      {/* Pulse Animation */}
      <style>{`
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.5; }
          100% { opacity: 1; }
        }
      `}</style>
    </Box>
  );
}