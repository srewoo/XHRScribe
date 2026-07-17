import React, { useState } from 'react';
import {
  Box,
  List,
  ListItem,
  ListItemText,
  Chip,
  Typography,
  IconButton,
  Button,
  Collapse,
  Paper,
  TextField,
  InputAdornment,
  Checkbox,
} from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';
import ExpandLess from '@mui/icons-material/ExpandLess';
import Search from '@mui/icons-material/Search';
import { NetworkRequest } from '@/types';
import WebSocketDetail from './WebSocketDetail';
import ProtobufDetail from './ProtobufDetail';

interface RequestListProps {
  requests: NetworkRequest[];
  selectionMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

// Render only this many rows at once; a session can hold thousands of requests
// and mounting them all janks the popup. Rows are expandable (variable height)
// so a fixed-size virtual list is unsuitable — we window by render cap instead
// and let the user reveal more on demand. (plan.md 6.1)
const RENDER_CAP = 150;

export default function RequestList({ requests, selectionMode, selectedIds, onToggleSelect }: RequestListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [visibleCount, setVisibleCount] = useState(RENDER_CAP);

  const getMethodColor = (method: string) => {
    const colors: Record<string, any> = {
      GET: 'primary',
      POST: 'success',
      PUT: 'warning',
      DELETE: 'error',
      PATCH: 'info',
    };
    return colors[method] || 'default';
  };

  const getStatusColor = (status?: number) => {
    if (!status) return 'default';
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'warning';
    if (status >= 400 && status < 500) return 'error';
    if (status >= 500) return 'error';
    return 'default';
  };

  const formatUrl = (url: string) => {
    try {
      const parsed = new URL(url);
      return parsed.pathname + parsed.search;
    } catch {
      return url;
    }
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return '0ms';
    if (duration < 1000) return `${Math.round(duration)}ms`;
    return `${(duration / 1000).toFixed(2)}s`;
  };

  const filteredRequests = requests.filter((req) => {
    if (!filter) return true;
    const searchStr = filter.toLowerCase();
    return (
      req.url.toLowerCase().includes(searchStr) ||
      req.method.toLowerCase().includes(searchStr) ||
      req.status?.toString().includes(searchStr)
    );
  });

  // Reset the render window whenever the filter changes.
  React.useEffect(() => { setVisibleCount(RENDER_CAP); }, [filter]);

  const visibleRequests = filteredRequests.slice(0, visibleCount);
  const hiddenCount = filteredRequests.length - visibleRequests.length;

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  if (requests.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography variant="body2" color="text.secondary">
          No requests captured yet
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Filter */}
      <TextField
        fullWidth
        size="small"
        placeholder="Filter requests..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search fontSize="small" />
            </InputAdornment>
          ),
        }}
        sx={{ mb: 2 }}
      />

      {/* Request List */}
      <List sx={{ py: 0 }}>
        {visibleRequests.map((request) => (
          <Paper key={request.id} elevation={1} sx={{ mb: 1 }}>
            <ListItem
              onClick={() => selectionMode ? onToggleSelect?.(request.id) : toggleExpand(request.id)}
              sx={{ pr: 1, cursor: 'pointer' }}
            >
              {selectionMode && (
                <Checkbox
                  checked={selectedIds?.has(request.id) || false}
                  onChange={() => onToggleSelect?.(request.id)}
                  onClick={(e) => e.stopPropagation()}
                  size="small"
                  sx={{ mr: 0.5 }}
                />
              )}
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      label={request.method}
                      size="small"
                      color={getMethodColor(request.method)}
                      sx={{ minWidth: 60 }}
                    />
                    <Typography
                      variant="body2"
                      sx={{
                        flexGrow: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatUrl(request.url)}
                    </Typography>
                  </Box>
                }
                secondary={
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      mt: 0.5,
                    }}
                  >
                    {request.status && (
                      <Chip
                        label={request.status}
                        size="small"
                        color={getStatusColor(request.status)}
                        sx={{ height: 20 }}
                      />
                    )}
                    <Chip
                      label={request.type}
                      size="small"
                      variant="outlined"
                      sx={{ height: 20 }}
                    />
                    <Chip
                      label={formatDuration(request.duration)}
                      size="small"
                      variant="outlined"
                      sx={{ height: 20 }}
                    />
                  </Box>
                }
              />
              <IconButton size="small">
                {expandedId === request.id ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            </ListItem>

            {/* Expanded Details */}
            <Collapse in={expandedId === request.id}>
              <Box sx={{ p: 2, bgcolor: 'background.default' }}>
                <Typography variant="caption" color="text.secondary">
                  Full URL
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ mb: 2, wordBreak: 'break-all' }}
                >
                  {request.url}
                </Typography>

                {request.requestHeaders && (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      Request Headers
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 1, mb: 2 }}>
                      <pre style={{ margin: 0, fontSize: 11, overflow: 'auto' }}>
                        {JSON.stringify(request.requestHeaders, null, 2)}
                      </pre>
                    </Paper>
                  </>
                )}

                {request.requestBody && (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      Request Body
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 1, mb: 2 }}>
                      <pre style={{ margin: 0, fontSize: 11, overflow: 'auto' }}>
                        {typeof request.requestBody === 'string'
                          ? request.requestBody
                          : JSON.stringify(request.requestBody, null, 2)}
                      </pre>
                    </Paper>
                  </>
                )}

                {request.type === 'gRPC' && request.responseBody ? (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      Protobuf Response
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 1 }}>
                      <ProtobufDetail
                        data={typeof request.responseBody === 'string' ? request.responseBody : JSON.stringify(request.responseBody)}
                        contentType={request.responseHeaders?.['content-type'] || request.responseHeaders?.['Content-Type']}
                      />
                    </Paper>
                  </>
                ) : request.type === 'WebSocket' && Array.isArray(request.responseBody) ? (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      WebSocket Frames
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 1 }}>
                      <WebSocketDetail frames={request.responseBody} />
                    </Paper>
                  </>
                ) : request.responseBody && (
                  <>
                    <Typography variant="caption" color="text.secondary">
                      Response Body
                    </Typography>
                    <Paper variant="outlined" sx={{ p: 1 }}>
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 11,
                          overflow: 'auto',
                          maxHeight: 200,
                        }}
                      >
                        {typeof request.responseBody === 'string'
                          ? request.responseBody
                          : JSON.stringify(request.responseBody, null, 2)}
                      </pre>
                    </Paper>
                  </>
                )}
              </Box>
            </Collapse>
          </Paper>
        ))}
      </List>

      {hiddenCount > 0 && (
        <Box sx={{ textAlign: 'center', py: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
            Showing {visibleRequests.length} of {filteredRequests.length} requests
          </Typography>
          <Button size="small" onClick={() => setVisibleCount((c) => c + RENDER_CAP)}>
            Show {Math.min(hiddenCount, RENDER_CAP)} more
          </Button>
        </Box>
      )}
    </Box>
  );
}