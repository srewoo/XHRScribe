import React, { useState } from 'react';
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
  TextField,
} from '@mui/material';
import {
  Delete,
  Download,
  Code,
  Timer,
  NetworkCheck,
  Edit,
  Api,
  Description,
  InsertDriveFile,
  ImportExport,
  RadioButtonChecked,
  Folder,
  Language,
} from '@mui/icons-material';
import { RecordingSession } from '@/types';
import { useStore } from '@/store/useStore';

interface SessionListProps {
  sessions: RecordingSession[];
}

export default function SessionList({ sessions }: SessionListProps) {
  const { deleteSession, renameSession, selectSession, setLoading } = useStore();
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [sessionToRename, setSessionToRename] = useState<RecordingSession | null>(null);
  const [newSessionName, setNewSessionName] = useState('');

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  };

  // Helper functions for imported sessions
  const isImportedSession = (session: RecordingSession): boolean => {
    return session.id.startsWith('imported_') ||
           session.metadata?.source?.includes('_import') ||
           session.metadata?.type === 'imported';
  };

  const getSessionTypeIcon = (session: RecordingSession) => {
    if (isImportedSession(session)) {
      switch (session.metadata?.source) {
        case 'har_import':
          return <InsertDriveFile sx={{ color: '#4caf50' }} />;
        case 'postman_import':
          return <Api sx={{ color: '#ff9800' }} />;
        case 'openapi_import':
          return <Description sx={{ color: '#2196f3' }} />;
        case 'insomnia_import':
          return <Language sx={{ color: '#673ab7' }} />;
        default:
          return <ImportExport sx={{ color: '#9e9e9e' }} />;
      }
    }
    return <RadioButtonChecked sx={{ color: '#f44336' }} />;
  };

  const getImportTypeLabel = (session: RecordingSession): string => {
    if (!isImportedSession(session)) return 'Recorded';

    switch (session.metadata?.source) {
      case 'har_import':
        return 'HAR Import';
      case 'postman_import':
        return 'Postman Import';
      case 'openapi_import':
        return 'OpenAPI Import';
      case 'insomnia_import':
        return 'Insomnia Import';
      default:
        return 'Imported';
    }
  };

  const handleSessionClick = (session: RecordingSession) => {
    selectSession(session);
    // Trigger a custom event to switch to generate tab
    window.dispatchEvent(new CustomEvent('switchToGenerate'));
  };

  const handleRename = (session: RecordingSession) => {
    setSessionToRename(session);
    setNewSessionName(session.name);
    setRenameDialogOpen(true);
  };

  const handleRenameSubmit = async () => {
    if (sessionToRename && newSessionName.trim()) {
      await renameSession(sessionToRename.id, newSessionName.trim());
      setRenameDialogOpen(false);
      setSessionToRename(null);
      setNewSessionName('');
    }
  };

  const handleExport = (session: RecordingSession) => {
    // Export HAR data
    const harData = {
      log: {
        version: '1.2',
        creator: {
          name: 'XHRScribe',
          version: '1.0.0'
        },
        entries: session.requests.map(request => ({
          request: {
            method: request.method,
            url: request.url,
            headers: Object.entries(request.requestHeaders || {}).map(([name, value]) => ({ name, value })),
            postData: request.requestBody ? { text: JSON.stringify(request.requestBody) } : undefined
          },
          response: {
            status: request.status || 0,
            headers: Object.entries(request.responseHeaders || {}).map(([name, value]) => ({ name, value })),
            content: { text: request.responseBody ? JSON.stringify(request.responseBody) : '' }
          },
          startedDateTime: new Date(request.timestamp).toISOString(),
          time: request.duration || 0
        }))
      }
    };

    const blob = new Blob([JSON.stringify(harData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.name.replace(/\s+/g, '-')}.har`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (sessions.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <NetworkCheck sx={{ fontSize: 48, color: 'text.disabled' }} />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          No recording sessions yet
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Start recording to capture API requests or use the Import tab to import from HAR, Postman, OpenAPI, or Insomnia
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Session Count */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2" color="text.secondary">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      {/* Sessions List */}
      <List sx={{ maxHeight: 300, overflow: 'auto' }}>
        {sessions.map((session) => (
          <Paper key={session.id} elevation={1} sx={{ mb: 1 }}>
            <ListItem
              component="div"
              onClick={() => handleSessionClick(session)}
              sx={{
                '&:hover': {
                  bgcolor: 'action.hover',
                  cursor: 'pointer'
                },
                bgcolor: isImportedSession(session) ? 'action.selected' : 'transparent'
              }}
            >
              <Box sx={{ mr: 2 }}>
                {getSessionTypeIcon(session)}
              </Box>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'medium' }}>
                      {session.name}
                    </Typography>
                    <Chip
                      label={getImportTypeLabel(session)}
                      size="small"
                      variant={isImportedSession(session) ? "filled" : "outlined"}
                      color={isImportedSession(session) ? "primary" : "default"}
                      sx={{ fontSize: '0.7rem', height: 20 }}
                    />
                  </Box>
                }
                secondary={
                  <Box sx={{ mt: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Code sx={{ fontSize: 14 }} />
                        <Typography variant="caption">
                          {session.requests.length} requests
                        </Typography>
                      </Box>

                      {session.startTime && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <Timer sx={{ fontSize: 14 }} />
                          <Typography variant="caption">
                            {formatDate(session.startTime)}
                          </Typography>
                        </Box>
                      )}

                      {session.url && (
                        <Typography variant="caption" color="text.secondary" sx={{
                          maxWidth: 200,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}>
                          {session.url}
                        </Typography>
                      )}
                    </Box>

                    {/* Import metadata */}
                    {isImportedSession(session) && session.metadata && (
                      <Box sx={{ mt: 0.5, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {session.metadata.collectionName && (
                          <Chip
                            label={session.metadata.collectionName}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: '0.65rem', height: 18 }}
                          />
                        )}
                        {session.metadata.apiTitle && (
                          <Chip
                            label={session.metadata.apiTitle}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: '0.65rem', height: 18 }}
                          />
                        )}
                        {session.metadata.apiVersion && (
                          <Chip
                            label={`v${session.metadata.apiVersion}`}
                            size="small"
                            variant="outlined"
                            sx={{ fontSize: '0.65rem', height: 18 }}
                          />
                        )}
                      </Box>
                    )}
                  </Box>
                }
              />
              <ListItemSecondaryAction>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Tooltip title="Rename Session">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRename(session);
                      }}
                    >
                      <Edit fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  <Tooltip title="Export HAR">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExport(session);
                      }}
                    >
                      <Download fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  <Tooltip title="Delete Session">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(session.id);
                      }}
                      color="error"
                    >
                      <Delete fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </ListItemSecondaryAction>
            </ListItem>
          </Paper>
        ))}
      </List>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Rename Session</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Session Name"
            fullWidth
            variant="outlined"
            value={newSessionName}
            onChange={(e) => setNewSessionName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleRenameSubmit();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleRenameSubmit} variant="contained" disabled={!newSessionName.trim()}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}