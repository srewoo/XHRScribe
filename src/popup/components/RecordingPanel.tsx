import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Chip,
  LinearProgress,
} from '@mui/material';
import { PlayArrow, Stop, Timer } from '@mui/icons-material';
import { RecordingSession } from '@/types';

interface RecordingPanelProps {
  recording: boolean;
  currentSession?: RecordingSession;
  onStart: () => void;
  onStop: () => void;
  loading: boolean;
}

export default function RecordingPanel({
  recording,
  currentSession,
  onStart,
  onStop,
  loading,
}: RecordingPanelProps) {
  const [duration, setDuration] = React.useState(0);

  React.useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (recording && currentSession) {
      interval = setInterval(() => {
        setDuration(Date.now() - currentSession.startTime);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(interval);
  }, [recording, currentSession]);

  const formatDuration = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60)
        .toString()
        .padStart(2, '0')}`;
    }
    return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
  };

  return (
    <Paper elevation={1} sx={{ p: 2, mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Network Recording
          </Typography>
          {recording && currentSession ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">
                Recording from: {new URL(currentSession.url).hostname}
              </Typography>
              <Chip
                icon={<Timer />}
                label={formatDuration(duration)}
                size="small"
                color="error"
              />
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Click start to begin capturing API requests
            </Typography>
          )}
        </Box>

        <Button
          variant="contained"
          color={recording ? 'error' : 'primary'}
          startIcon={recording ? <Stop /> : <PlayArrow />}
          onClick={recording ? onStop : onStart}
          disabled={loading}
          size="small"
        >
          {recording ? 'Stop' : 'Start'}
        </Button>
      </Box>

      {recording && (
        <Box sx={{ mt: 2 }}>
          <LinearProgress color="error" />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <Chip label={`${currentSession?.requests.length || 0} requests`} size="small" />
            <Chip label="Live" size="small" color="error" />
          </Box>
        </Box>
      )}
    </Paper>
  );
}