import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  Chip,
  Paper,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Collapse,
  IconButton,
  TextField,
  InputAdornment,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import {
  ArrowUpward,
  ArrowDownward,
  ExpandMore,
  ExpandLess,
  Search,
} from '@mui/icons-material';
import { WebSocketParser } from '@/services/WebSocketParser';
import { ParsedWebSocketFrame } from '@/types';

interface WebSocketDetailProps {
  frames: any[];
}

export default function WebSocketDetail({ frames }: WebSocketDetailProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'sent' | 'received'>('all');

  const parser = WebSocketParser.getInstance();
  const parsedFrames = useMemo(() => parser.parseFrames(frames), [frames]);
  const stats = useMemo(() => parser.computeStats(parsedFrames), [parsedFrames]);

  const filteredFrames = useMemo(() => {
    return parsedFrames.filter((frame) => {
      if (directionFilter !== 'all' && frame.direction !== directionFilter) return false;
      if (filter) {
        const search = filter.toLowerCase();
        return (
          frame.data.toLowerCase().includes(search) ||
          (frame.eventType || '').toLowerCase().includes(search) ||
          (frame.channel || '').toLowerCase().includes(search)
        );
      }
      return true;
    });
  }, [parsedFrames, filter, directionFilter]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const truncateData = (data: string, maxLen = 80) => {
    if (data.length <= maxLen) return data;
    return data.substring(0, maxLen) + '...';
  };

  return (
    <Box>
      {/* Stats Bar */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
        <Chip label={`${stats.totalFrames} frames`} size="small" color="primary" />
        <Chip label={`${stats.sentFrames} sent`} size="small" variant="outlined" icon={<ArrowUpward sx={{ fontSize: 14 }} />} />
        <Chip label={`${stats.receivedFrames} recv`} size="small" variant="outlined" icon={<ArrowDownward sx={{ fontSize: 14 }} />} />
        <Chip label={`${stats.jsonFrames} JSON`} size="small" variant="outlined" color="info" />
        <Chip label={formatSize(stats.totalBytes)} size="small" variant="outlined" />
        {stats.durationMs > 0 && (
          <Chip label={formatDuration(stats.durationMs)} size="small" variant="outlined" />
        )}
      </Box>

      {/* Event Types & Channels */}
      {(stats.eventTypes.length > 0 || stats.channels.length > 0) && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
          {stats.eventTypes.map((et) => (
            <Chip key={`et-${et}`} label={et} size="small" color="secondary" variant="outlined" sx={{ fontSize: 10 }} />
          ))}
          {stats.channels.map((ch) => (
            <Chip key={`ch-${ch}`} label={`#${ch}`} size="small" color="warning" variant="outlined" sx={{ fontSize: 10 }} />
          ))}
        </Box>
      )}

      {/* Filter & Direction Toggle */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Filter frames..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ flexGrow: 1 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 16 }} />
              </InputAdornment>
            ),
          }}
        />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={directionFilter}
          onChange={(_, v) => v && setDirectionFilter(v)}
        >
          <ToggleButton value="all" sx={{ px: 1, py: 0.25, fontSize: 11 }}>All</ToggleButton>
          <ToggleButton value="sent" sx={{ px: 1, py: 0.25, fontSize: 11 }}>Sent</ToggleButton>
          <ToggleButton value="received" sx={{ px: 1, py: 0.25, fontSize: 11 }}>Recv</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Frame List */}
      <List sx={{ py: 0, maxHeight: 300, overflow: 'auto' }}>
        {filteredFrames.map((frame, index) => (
          <Paper key={index} variant="outlined" sx={{ mb: 0.5 }}>
            <ListItem
              dense
              onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
              sx={{ cursor: 'pointer', py: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                {frame.direction === 'sent' ? (
                  <ArrowUpward sx={{ fontSize: 16, color: 'success.main' }} />
                ) : (
                  <ArrowDownward sx={{ fontSize: 16, color: 'info.main' }} />
                )}
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {frame.eventType && (
                      <Chip label={frame.eventType} size="small" sx={{ height: 18, fontSize: 10 }} color="secondary" />
                    )}
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {truncateData(frame.data)}
                    </Typography>
                    <Chip label={frame.dataType} size="small" sx={{ height: 16, fontSize: 9 }} variant="outlined" />
                  </Box>
                }
              />
              <IconButton size="small" sx={{ p: 0.25 }}>
                {expandedIndex === index ? <ExpandLess sx={{ fontSize: 16 }} /> : <ExpandMore sx={{ fontSize: 16 }} />}
              </IconButton>
            </ListItem>

            <Collapse in={expandedIndex === index}>
              <Box sx={{ p: 1.5, bgcolor: 'background.default' }}>
                <pre style={{ margin: 0, fontSize: 11, overflow: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {frame.parsedData
                    ? JSON.stringify(frame.parsedData, null, 2)
                    : frame.data}
                </pre>
              </Box>
            </Collapse>
          </Paper>
        ))}
      </List>

      {filteredFrames.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', py: 2 }}>
          No frames match the current filter
        </Typography>
      )}
    </Box>
  );
}
