import React, { useState, useRef } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Typography,
  Chip,
  Paper,
  Tooltip,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  LinearProgress,
  Alert,
  CircularProgress,
  TextField,
} from '@mui/material';
import {
  Delete,
  Download,
  Code,
  Timer,
  NetworkCheck,
  UploadFile,
  CloudUpload,
  Edit,
} from '@mui/icons-material';
import { RecordingSession, HARData } from '@/types';
import { useStore } from '@/store/useStore';

interface SessionListProps {
  sessions: RecordingSession[];
}

export default function SessionList({ sessions }: SessionListProps) {
  const { deleteSession, renameSession, selectSession, setLoading } = useStore();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadedHAR, setUploadedHAR] = useState<HARData | null>(null);
  const [uploadError, setUploadError] = useState<string>('');
  const [processingUpload, setProcessingUpload] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [sessionToRename, setSessionToRename] = useState<RecordingSession | null>(null);
  const [newSessionName, setNewSessionName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  const getDuration = (session: RecordingSession) => {
    if (!session.endTime) return '0s';
    const duration = session.endTime - session.startTime;
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const handleDelete = async (sessionId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    if (window.confirm('Are you sure you want to delete this session?')) {
      await deleteSession(sessionId);
    }
  };

  const handleRename = (session: RecordingSession, event: React.MouseEvent) => {
    event.stopPropagation();
    setSessionToRename(session);
    setNewSessionName(session.name);
    setRenameDialogOpen(true);
  };

  const handleRenameConfirm = async () => {
    if (!sessionToRename || !newSessionName.trim()) return;
    
    try {
      await renameSession(sessionToRename.id, newSessionName.trim());
      setRenameDialogOpen(false);
      setSessionToRename(null);
      setNewSessionName('');
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  };

  const handleExport = (session: RecordingSession, event: React.MouseEvent) => {
    event.stopPropagation();
    // Export HAR data
    const harData = {
      session: {
        id: session.id,
        name: session.name,
        url: session.url,
        startTime: session.startTime,
        endTime: session.endTime,
      },
      requests: session.requests,
    };
    
    const blob = new Blob([JSON.stringify(harData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.name.replace(/\s+/g, '-')}.har`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadError('');
    setProcessingUpload(true);

    // Add slight delay to show loading state for better UX
    setTimeout(() => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const data = JSON.parse(content);
        
        // Validate HAR structure
        if (!isValidHAR(data)) {
          throw new Error('Invalid HAR file format');
        }

        // Debug: Log the structure to understand the format
        console.log('HAR file structure:', {
          hasLog: !!data.log,
          hasLogEntries: !!(data.log?.entries),
          hasSession: !!data.session,
          hasRequests: !!data.requests,
          hasEntries: !!data.entries,
          isArray: Array.isArray(data),
          entriesCount: data.log?.entries?.length || data.entries?.length || data.requests?.length || (Array.isArray(data) ? data.length : 0)
        });
        
        // Extract HAR data
        let harData: HARData;
        
        // Check if it's our custom export format (from handleExport)
        if (data.session && data.requests) {
          harData = {
            version: '1.2',
            creator: { name: 'XHRScribe Export', version: '1.0.0' },
            entries: data.requests.map(convertToHAREntry)
          };
        }
        // Standard HAR format
        else if (data.log && data.log.entries) {
          harData = {
            version: data.log.version || '1.2',
            creator: data.log.creator || { name: 'User Upload', version: '1.0.0' },
            entries: data.log.entries
          };
        }
        // Direct entries array
        else if (data.entries && Array.isArray(data.entries)) {
          harData = {
            version: '1.2',
            creator: { name: 'User Upload', version: '1.0.0' },
            entries: data.entries
          };
        }
        // Raw array of requests
        else if (Array.isArray(data)) {
          harData = {
            version: '1.2',
            creator: { name: 'User Upload', version: '1.0.0' },
            entries: data.map(convertToHAREntry)
          };
        }
        // Fallback
        else {
          harData = {
            version: '1.2',
            creator: { name: 'User Upload', version: '1.0.0' },
            entries: []
          };
        }

        console.log('Parsed HAR data:', {
          entriesCount: harData.entries.length,
          firstEntry: harData.entries[0]
        });
        
        setUploadedHAR(harData);
        setUploadDialogOpen(true);
      } catch (error) {
        setUploadError(error instanceof Error ? error.message : 'Failed to parse HAR file');
      } finally {
        setProcessingUpload(false);
      }
    };

    reader.onerror = () => {
      setUploadError('Failed to read file');
      setProcessingUpload(false);
    };

      reader.readAsText(file);
    }, 100); // Small delay to ensure loading state is visible
  };

  const isValidHAR = (data: any): boolean => {
    // Check if it's a standard HAR format
    if (data.log && data.log.entries && Array.isArray(data.log.entries)) {
      return true;
    }
    
    // Check if it's our custom export format
    if (data.session && data.requests && Array.isArray(data.requests)) {
      return true;
    }
    
    // Check if it's a raw array of entries
    if (Array.isArray(data) && data.length > 0) {
      return true;
    }
    
    // Check if it has entries directly
    if (data.entries && Array.isArray(data.entries)) {
      return true;
    }
    
    return false;
  };

  const convertToHAREntry = (request: any): any => {
    // Convert custom format to HAR entry if needed
    if (request.request && request.response) {
      return request; // Already in HAR format
    }
    
    // Convert from our NetworkRequest format
    return {
      startedDateTime: new Date(request.timestamp || Date.now()).toISOString(),
      time: request.duration || 0,
      request: {
        method: request.method || 'GET',
        url: request.url || '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(request.requestHeaders || {}).map(([name, value]) => ({
          name,
          value,
        })),
        queryString: [],
        postData: request.requestBody ? {
          mimeType: 'application/json',
          text: typeof request.requestBody === 'string' 
            ? request.requestBody 
            : JSON.stringify(request.requestBody)
        } : undefined,
        headersSize: -1,
        bodySize: -1,
      },
      response: {
        status: request.status || 200,
        statusText: '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(request.responseHeaders || {}).map(([name, value]) => ({
          name,
          value,
        })),
        content: {
          size: request.responseSize || 0,
          mimeType: 'application/json',
          text: request.responseBody ? 
            (typeof request.responseBody === 'string' 
              ? request.responseBody 
              : JSON.stringify(request.responseBody)) : undefined,
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: request.responseSize || 0,
      },
      cache: {},
      timings: {
        blocked: -1,
        dns: -1,
        connect: -1,
        send: 0,
        wait: request.duration || 0,
        receive: 0,
        ssl: -1,
      },
    };
  };

  const handleProcessUploadedHAR = async () => {
    if (!uploadedHAR) return;

    // Create a session from uploaded HAR
    const uploadedSession: RecordingSession = {
      id: `uploaded_${Date.now()}`,
      name: `Uploaded HAR - ${new Date().toLocaleString()}`,
      startTime: Date.now(),
      endTime: Date.now(),
      requests: uploadedHAR.entries.map((entry, index) => ({
        id: `req_${index}`,
        url: entry.request.url,
        method: entry.request.method,
        status: entry.response.status,
        type: 'Fetch' as const,
        timestamp: new Date(entry.startedDateTime).getTime(),
        duration: entry.time,
        requestHeaders: entry.request.headers?.reduce((acc, h) => ({
          ...acc,
          [h.name]: h.value
        }), {}),
        responseHeaders: entry.response.headers?.reduce((acc, h) => ({
          ...acc,
          [h.name]: h.value
        }), {}),
        requestBody: entry.request.postData?.text,
        responseBody: entry.response.content.text,
        responseSize: entry.response.bodySize,
      })),
      tabId: -1,
      url: uploadedHAR.entries[0]?.request.url || 'Uploaded File',
      status: 'stopped',
    };

    // Save the session to storage using background service
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_SESSION',
        payload: { session: uploadedSession }
      });
      
      if (response && response.success) {
        // Reload sessions to show the new uploaded session
        await useStore.getState().loadSessions();
        
        // Select the newly uploaded session
        selectSession(uploadedSession);
        setUploadDialogOpen(false);
        setUploadedHAR(null);
        
        // Switch to generate tab (the parent component should handle this)
        const event = new CustomEvent('switchToGenerate');
        window.dispatchEvent(event);
      } else {
        setUploadError('Failed to save uploaded session');
      }
    } catch (error) {
      console.error('Failed to save uploaded session:', error);
      setUploadError('Failed to save uploaded session');
    }
  };

  if (sessions.length === 0 && !processingUpload) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <NetworkCheck sx={{ fontSize: 48, color: 'text.disabled' }} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          No recording sessions yet
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Start recording to capture API requests
        </Typography>
        
        <Box sx={{ mt: 3 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Or upload a HAR file to generate tests
          </Typography>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".har,.json"
            onChange={handleFileUpload}
          />
          <Button
            variant="outlined"
            startIcon={<CloudUpload />}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload HAR File
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box>
      {/* Upload HAR Button */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2" color="text.secondary">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </Typography>
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".har,.json"
          onChange={handleFileUpload}
        />
        <Button
          size="small"
          variant="outlined"
          startIcon={<UploadFile />}
          onClick={() => fileInputRef.current?.click()}
          disabled={processingUpload}
        >
          Upload HAR
        </Button>
      </Box>

      {/* Processing Indicator - More prominent */}
      {processingUpload && (
        <Paper elevation={2} sx={{ p: 2, mb: 2, bgcolor: 'background.paper' }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={24} />
            <Typography variant="body2" color="primary">
              Processing HAR file...
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Parsing and validating API requests
            </Typography>
            <LinearProgress sx={{ width: '100%', mt: 1 }} />
          </Box>
        </Paper>
      )}

      {/* Error Alert */}
      {uploadError && (
        <Alert severity="error" onClose={() => setUploadError('')} sx={{ mb: 2 }}>
          {uploadError}
        </Alert>
      )}

      {/* Sessions List */}
      <List sx={{ py: 0 }}>
        {sessions.map((session) => (
          <Paper
            key={session.id}
            elevation={1}
            sx={{
              mb: 1,
              cursor: 'pointer',
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
            onClick={() => selectSession(session)}
          >
            <ListItem sx={{ pr: 15 }}>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body1" noWrap sx={{ maxWidth: '60%' }}>
                      {session.name}
                    </Typography>
                    <Chip
                      label={`${session.requests.length} requests`}
                      size="small"
                      variant="outlined"
                    />
                  </Box>
                }
                secondary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">
                      {formatDate(session.startTime)}
                    </Typography>
                    <Chip
                      icon={<Timer />}
                      label={getDuration(session)}
                      size="small"
                      sx={{ height: 20 }}
                    />
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <Tooltip title="Rename">
                  <IconButton
                    size="small"
                    onClick={(e) => handleRename(session, e)}
                  >
                    <Edit />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Generate tests">
                  <IconButton 
                    size="small" 
                    onClick={(e) => {
                      e.stopPropagation();
                      selectSession(session);
                      // Switch to generate tab
                      const event = new CustomEvent('switchToGenerate');
                      window.dispatchEvent(event);
                    }}
                  >
                    <Code />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Export HAR">
                  <IconButton
                    size="small"
                    onClick={(e) => handleExport(session, e)}
                  >
                    <Download />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete">
                  <IconButton
                    size="small"
                    color="error"
                    onClick={(e) => handleDelete(session.id, e)}
                  >
                    <Delete />
                  </IconButton>
                </Tooltip>
              </ListItemSecondaryAction>
            </ListItem>
          </Paper>
        ))}
      </List>

      {/* Rename Session Dialog */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Rename Session</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Session Name"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleRenameConfirm();
              }
            }}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRenameConfirm} variant="contained" disabled={!newSessionName.trim()}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upload HAR Dialog */}
      <Dialog open={uploadDialogOpen} onClose={() => setUploadDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>HAR File Uploaded Successfully</DialogTitle>
        <DialogContent>
          <Alert severity="success" sx={{ mb: 2 }}>
            HAR file parsed successfully!
          </Alert>
          <Typography variant="body2" gutterBottom>
            Found {uploadedHAR?.entries.length || 0} API requests in the HAR file.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Click "Generate Tests" to proceed with test generation for these requests.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUploadDialogOpen(false)}>Cancel</Button>
          <Button 
            variant="contained" 
            startIcon={<Code />}
            onClick={handleProcessUploadedHAR}
          >
            Generate Tests
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}