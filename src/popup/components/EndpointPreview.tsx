import React, { useMemo, useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Badge,
  Tooltip,
  Paper,
  IconButton
} from '@mui/material';
import {
  ExpandMore,
  CheckCircle,
  Warning,
  Info,
  Close
} from '@mui/icons-material';
import { RecordingSession, NetworkRequest } from '@/types';

interface EndpointInfo {
  method: string;
  path: string;
  fullUrl: string;
  count: number;
  statusCodes: number[];
  hasBody: boolean;
  domain: string;
  signature: string; // Add unique signature for tracking exclusions
}

interface EndpointPreviewProps {
  session: RecordingSession;
  showDetails?: boolean;
  excludedEndpoints?: Set<string>;
  onEndpointToggle?: (signature: string, excluded: boolean) => void;
}

const EndpointPreview: React.FC<EndpointPreviewProps> = ({ 
  session, 
  showDetails = false,
  excludedEndpoints = new Set(),
  onEndpointToggle
}) => {
  const endpointAnalysis = useMemo(() => {
    const endpointMap = new Map<string, EndpointInfo>();
    
    session.requests.forEach(req => {
      try {
        const url = new URL(req.url);
        const signature = `${req.method}:${url.pathname}`;
        
        if (endpointMap.has(signature)) {
          const existing = endpointMap.get(signature)!;
          existing.count++;
          if (req.status && !existing.statusCodes.includes(req.status)) {
            existing.statusCodes.push(req.status);
          }
        } else {
          endpointMap.set(signature, {
            method: req.method,
            path: url.pathname,
            fullUrl: req.url,
            count: 1,
            statusCodes: req.status ? [req.status] : [],
            hasBody: !!(req.requestBody || req.responseBody),
            domain: url.hostname,
            signature: signature
          });
        }
      } catch (error) {
        // Handle invalid URLs
        const signature = `${req.method}:${req.url}`;
        if (!endpointMap.has(signature)) {
          endpointMap.set(signature, {
            method: req.method,
            path: req.url,
            fullUrl: req.url,
            count: 1,
            statusCodes: req.status ? [req.status] : [],
            hasBody: !!(req.requestBody || req.responseBody),
            domain: 'unknown',
            signature: signature
          });
        }
      }
    });
    
    return Array.from(endpointMap.values()).sort((a, b) => {
      // Sort by method first, then by path
      if (a.method !== b.method) {
        return a.method.localeCompare(b.method);
      }
      return a.path.localeCompare(b.path);
    });
  }, [session.requests]);

  const handleEndpointRemove = (signature: string) => {
    if (onEndpointToggle) {
      onEndpointToggle(signature, true);
    }
  };

  const handleEndpointRestore = (signature: string) => {
    if (onEndpointToggle) {
      onEndpointToggle(signature, false);
    }
  };

  const activeEndpoints = endpointAnalysis.filter(endpoint => !excludedEndpoints.has(endpoint.signature));
  const excludedCount = endpointAnalysis.length - activeEndpoints.length;

  const getMethodColor = (method: string) => {
    switch (method.toUpperCase()) {
      case 'GET': return 'success';
      case 'POST': return 'primary';
      case 'PUT': return 'warning';
      case 'PATCH': return 'warning';
      case 'DELETE': return 'error';
      default: return 'default';
    }
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'info';
    if (status >= 400 && status < 500) return 'warning';
    if (status >= 500) return 'error';
    return 'default';
  };

  const groupedByDomain = useMemo(() => {
    const groups = new Map<string, EndpointInfo[]>();
    endpointAnalysis.forEach(endpoint => {
      if (!groups.has(endpoint.domain)) {
        groups.set(endpoint.domain, []);
      }
      groups.get(endpoint.domain)!.push(endpoint);
    });
    return Array.from(groups.entries());
  }, [endpointAnalysis]);

  if (endpointAnalysis.length === 0) {
    return (
      <Paper sx={{ p: 2, mt: 2 }}>
        <Box display="flex" alignItems="center" gap={1}>
          <Warning color="warning" />
          <Typography variant="body2" color="text.secondary">
            No API endpoints detected in this session
          </Typography>
        </Box>
      </Paper>
    );
  }

  return (
    <Box sx={{ mt: 2 }}>
      <Box display="flex" alignItems="center" gap={1} mb={2}>
        <CheckCircle color="success" fontSize="small" />
        <Typography variant="h6" gutterBottom sx={{ m: 0 }}>
          Detected API Endpoints
        </Typography>
        <Chip 
          label={`${activeEndpoints.length} included`} 
          size="small" 
          color="primary" 
          variant="outlined" 
        />
        {excludedCount > 0 && (
          <Chip 
            label={`${excludedCount} excluded`} 
            size="small" 
            color="warning" 
            variant="outlined" 
          />
        )}
      </Box>

      {showDetails ? (
        // Detailed view with domains grouped
        <Box>
          {groupedByDomain.map(([domain, endpoints]) => (
            <Accordion key={domain} defaultExpanded={groupedByDomain.length === 1}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Typography variant="subtitle2">{domain}</Typography>
                  <Chip 
                    label={`${endpoints.length} endpoints`} 
                    size="small" 
                    variant="outlined" 
                  />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <List dense>
                  {endpoints.map((endpoint, index) => (
                    <ListItem key={index} sx={{ px: 0 }}>
                      <ListItemText
                        primary={
                          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                            <Chip
                              label={endpoint.method}
                              size="small"
                              color={getMethodColor(endpoint.method) as any}
                              sx={{ minWidth: 60 }}
                            />
                            <Typography 
                              variant="body2" 
                              component="code" 
                              sx={{ 
                                fontFamily: 'monospace',
                                bgcolor: 'grey.100',
                                px: 1,
                                py: 0.5,
                                borderRadius: 1,
                                fontSize: '0.75rem'
                              }}
                            >
                              {endpoint.path}
                            </Typography>
                            {endpoint.count > 1 && (
                              <Chip 
                                label={`${endpoint.count}x`} 
                                size="small" 
                                variant="outlined" 
                              />
                            )}
                          </Box>
                        }
                        secondary={
                          <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                            {endpoint.statusCodes.map(status => (
                              <Chip
                                key={status}
                                label={status}
                                size="small"
                                color={getStatusColor(status) as any}
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', height: 20 }}
                              />
                            ))}
                            {endpoint.hasBody && (
                              <Tooltip title="Has request/response body">
                                <Chip
                                  label="Body"
                                  size="small"
                                  variant="outlined"
                                  color="info"
                                  sx={{ fontSize: '0.7rem', height: 20 }}
                                />
                              </Tooltip>
                            )}
                          </Box>
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </AccordionDetails>
            </Accordion>
          ))}
        </Box>
      ) : (
        // Compact view
        <Box>
          {/* Active Endpoints */}
          <Box display="flex" flexWrap="wrap" gap={1} mb={excludedCount > 0 ? 2 : 0}>
            {activeEndpoints.map((endpoint, index) => (
              <Tooltip 
                key={index}
                title={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {endpoint.method} {endpoint.path}
                    </Typography>
                    <Typography variant="caption" display="block">
                      Domain: {endpoint.domain}
                    </Typography>
                    <Typography variant="caption" display="block">
                      Requests: {endpoint.count}
                    </Typography>
                    <Typography variant="caption" display="block">
                      Status codes: {endpoint.statusCodes.join(', ')}
                    </Typography>
                    {onEndpointToggle && (
                      <Typography variant="caption" display="block" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                        Click × to exclude from test generation
                      </Typography>
                    )}
                  </Box>
                }
              >
                <Badge 
                  badgeContent={endpoint.count > 1 ? endpoint.count : 0} 
                  color="secondary"
                >
                  <Chip
                    label={`${endpoint.method} ${endpoint.path.split('/').pop() || '/'}`}
                    size="small"
                    color={getMethodColor(endpoint.method) as any}
                    variant="outlined"
                    onDelete={onEndpointToggle ? () => handleEndpointRemove(endpoint.signature) : undefined}
                    deleteIcon={<Close sx={{ fontSize: 16 }} />}
                    sx={{ 
                      maxWidth: 200,
                      '& .MuiChip-label': {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      },
                      '& .MuiChip-deleteIcon': {
                        fontSize: 16,
                        '&:hover': {
                          color: 'error.main'
                        }
                      }
                    }}
                  />
                </Badge>
              </Tooltip>
            ))}
          </Box>

          {/* Excluded Endpoints */}
          {excludedCount > 0 && (
            <Box>
              <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 1 }}>
                Excluded from test generation:
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1}>
                {endpointAnalysis
                  .filter(endpoint => excludedEndpoints.has(endpoint.signature))
                  .map((endpoint, index) => (
                    <Tooltip 
                      key={index}
                      title={
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                            {endpoint.method} {endpoint.path}
                          </Typography>
                          <Typography variant="caption" display="block">
                            Click to include in test generation
                          </Typography>
                        </Box>
                      }
                    >
                      <Chip
                        label={`${endpoint.method} ${endpoint.path.split('/').pop() || '/'}`}
                        size="small"
                        color="default"
                        variant="outlined"
                        onClick={() => handleEndpointRestore(endpoint.signature)}
                        sx={{ 
                          maxWidth: 200,
                          opacity: 0.6,
                          cursor: 'pointer',
                          '& .MuiChip-label': {
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          },
                          '&:hover': {
                            opacity: 1,
                            borderColor: 'primary.main'
                          }
                        }}
                      />
                    </Tooltip>
                  ))}
              </Box>
            </Box>
          )}
        </Box>
      )}

      <Box mt={2} p={1} bgcolor="grey.50" borderRadius={1}>
        <Typography variant="caption" color="text.secondary" display="flex" alignItems="center" gap={0.5}>
          <Info fontSize="small" />
          {activeEndpoints.length === endpointAnalysis.length 
            ? `All ${activeEndpoints.length} endpoints will be included in the generated test suite`
            : `${activeEndpoints.length} of ${endpointAnalysis.length} endpoints will be included in the generated test suite`
          }
        </Typography>
      </Box>
    </Box>
  );
};

export default EndpointPreview;
