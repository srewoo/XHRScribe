import React from 'react';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  CircularProgress,
} from '@mui/material';
import {
  InsertDriveFile,
  CheckCircle,
  Error as ErrorIcon,
  Description,
  Code,
  Api,
  Delete,
} from '@mui/icons-material';

interface ImportedFile {
  name: string;
  type: 'har' | 'postman' | 'openapi' | 'insomnia';
  size: number;
  endpointCount?: number;
  status: 'processing' | 'success' | 'error';
  error?: string;
  sessionId?: string;
}

interface ImportHistoryProps {
  importedFiles: ImportedFile[];
  onRemoveFile: (fileName: string) => void;
}

const getFileIcon = (type: string) => {
  switch (type) {
    case 'har': return <InsertDriveFile />;
    case 'postman': return <Api />;
    case 'openapi': return <Description />;
    case 'insomnia': return <Code />;
    default: return <InsertDriveFile />;
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'success': return <CheckCircle color="success" />;
    case 'error': return <ErrorIcon color="error" />;
    case 'processing': return <CircularProgress size={20} />;
    default: return null;
  }
};

export default function ImportHistory({ importedFiles, onRemoveFile }: ImportHistoryProps) {
  if (importedFiles.length === 0) return null;

  return (
    <Paper elevation={1} sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ p: 2, pb: 0 }}>
        Import History
      </Typography>
      <List dense>
        {importedFiles.map((file, index) => (
          <ListItem key={index}>
            <ListItemIcon>
              {getFileIcon(file.type)}
            </ListItemIcon>
            <ListItemText
              primary={file.name}
              secondary={
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {file.type.toUpperCase()} &bull; {(file.size / 1024).toFixed(1)} KB
                    {file.endpointCount && ` \u2022 ${file.endpointCount} endpoints`}
                  </Typography>
                  {file.error && (
                    <Typography variant="caption" color="error" sx={{ display: 'block' }}>
                      Error: {file.error}
                    </Typography>
                  )}
                </Box>
              }
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {getStatusIcon(file.status)}
              <IconButton size="small" onClick={() => onRemoveFile(file.name)}>
                <Delete fontSize="small" />
              </IconButton>
            </Box>
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
