import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Slider,
  Switch,
  FormControlLabel,
  Chip,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Alert,
} from '@mui/material';
import {
  PlayArrow,
  Stop,
  CheckCircle,
  Error as ErrorIcon,
  Warning,
} from '@mui/icons-material';
import { RecordingSession, ReplayConfig, ReplayResult, ReplaySessionResult } from '@/types';
import { TrafficReplayService } from '@/services/TrafficReplayService';

interface ReplayPanelProps {
  session: RecordingSession;
}

export default function ReplayPanel({ session }: ReplayPanelProps) {
  const [config, setConfig] = useState<ReplayConfig>({
    baseUrl: '',
    delayMs: 100,
    includeHeaders: true,
    skipPatterns: [],
  });
  const [skipPatternsText, setSkipPatternsText] = useState('');
  const [replaying, setReplaying] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [liveResults, setLiveResults] = useState<ReplayResult[]>([]);
  const [summary, setSummary] = useState<ReplaySessionResult | null>(null);

  const handleReplay = async () => {
    setReplaying(true);
    setLiveResults([]);
    setSummary(null);

    const replayConfig: ReplayConfig = {
      ...config,
      skipPatterns: skipPatternsText.split(',').map(s => s.trim()).filter(Boolean),
    };

    try {
      const result = await TrafficReplayService.getInstance().replaySession(
        session,
        replayConfig,
        (current, total, replayResult) => {
          setProgress({ current, total });
          setLiveResults(prev => [...prev, replayResult]);
        }
      );
      setSummary(result);
    } catch (error) {
      // Cancelled or error
    } finally {
      setReplaying(false);
    }
  };

  const handleCancel = () => {
    TrafficReplayService.getInstance().cancel();
    setReplaying(false);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const getResultIcon = (result: ReplayResult) => {
    if (result.error) return <ErrorIcon sx={{ color: 'error.main', fontSize: 16 }} />;
    if (result.matched) return <CheckCircle sx={{ color: 'success.main', fontSize: 16 }} />;
    return <Warning sx={{ color: 'warning.main', fontSize: 16 }} />;
  };

  return (
    <Box>
      <Alert severity="info" sx={{ mb: 2, py: 0 }}>
        <Typography variant="caption">
          Replay captured requests against the original or a different server to compare responses.
        </Typography>
      </Alert>

      {/* Config */}
      <TextField
        fullWidth
        size="small"
        label="Base URL Override (optional)"
        placeholder="https://staging.example.com"
        value={config.baseUrl}
        onChange={(e) => setConfig({ ...config, baseUrl: e.target.value })}
        sx={{ mb: 1.5 }}
        disabled={replaying}
      />

      <Box sx={{ display: 'flex', gap: 2, mb: 1.5, alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Delay between requests: {config.delayMs}ms
          </Typography>
          <Slider
            value={config.delayMs}
            onChange={(_, v) => setConfig({ ...config, delayMs: v as number })}
            min={0}
            max={2000}
            step={50}
            size="small"
            disabled={replaying}
          />
        </Box>
        <FormControlLabel
          control={
            <Switch
              checked={config.includeHeaders}
              onChange={(e) => setConfig({ ...config, includeHeaders: e.target.checked })}
              size="small"
              disabled={replaying}
            />
          }
          label={<Typography variant="caption">Include headers</Typography>}
        />
      </Box>

      <TextField
        fullWidth
        size="small"
        label="Skip URL patterns (comma-separated)"
        placeholder="analytics, tracking, cdn"
        value={skipPatternsText}
        onChange={(e) => setSkipPatternsText(e.target.value)}
        sx={{ mb: 2 }}
        disabled={replaying}
      />

      {/* Controls */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
        {replaying ? (
          <Button
            variant="outlined"
            color="error"
            startIcon={<Stop />}
            onClick={handleCancel}
            fullWidth
          >
            Cancel ({progress.current}/{progress.total})
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={<PlayArrow />}
            onClick={handleReplay}
            fullWidth
            disabled={session.requests.length === 0}
          >
            Replay {session.requests.length} Requests
          </Button>
        )}
      </Box>

      {/* Progress */}
      {replaying && progress.total > 0 && (
        <LinearProgress
          variant="determinate"
          value={(progress.current / progress.total) * 100}
          sx={{ mb: 2 }}
        />
      )}

      {/* Summary */}
      {summary && (
        <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}>
            <Chip label={`${summary.passed} passed`} size="small" color="success" />
            <Chip label={`${summary.failed} failed`} size="small" color="warning" />
            <Chip label={`${summary.errors} errors`} size="small" color="error" />
          </Box>
          <Typography variant="caption" color="text.secondary">
            Avg duration: {formatDuration(summary.avgOriginalDuration)} (original) vs {formatDuration(summary.avgReplayDuration)} (replay)
          </Typography>
        </Paper>
      )}

      {/* Live Results */}
      {liveResults.length > 0 && (
        <List dense sx={{ maxHeight: 200, overflow: 'auto', py: 0 }}>
          {liveResults.map((result, i) => (
            <ListItem key={i} sx={{ px: 0, py: 0.25 }}>
              <ListItemIcon sx={{ minWidth: 24 }}>
                {getResultIcon(result)}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box display="flex" alignItems="center" gap={0.5}>
                    <Chip label={result.method} size="small" sx={{ height: 18, fontSize: 9 }} />
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {result.requestUrl.split('?')[0].split('/').slice(-2).join('/')}
                    </Typography>
                    {result.error ? (
                      <Chip label="ERR" size="small" color="error" sx={{ height: 16, fontSize: 9 }} />
                    ) : (
                      <Typography variant="caption" color={result.matched ? 'success.main' : 'warning.main'} sx={{ fontSize: 10 }}>
                        {result.originalStatus} &rarr; {result.replayStatus}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>
                      {formatDuration(result.replayDuration)}
                    </Typography>
                  </Box>
                }
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
