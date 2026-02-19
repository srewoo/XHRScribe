import React, { useMemo, useState } from 'react';
import { normalizePath } from '@/services/EndpointGrouper';
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
  Close,
  ViewList,
  AccountTree,
} from '@mui/icons-material';
import { RecordingSession, NetworkRequest, EndpointGroup } from '@/types';
import { EndpointGrouper } from '@/services/EndpointGrouper';

// GraphQL detection and operation extraction helpers
const isGraphQLEndpoint = (pathname: string, request: NetworkRequest): boolean => {
  return pathname.includes('graphql') || pathname.includes('gql') || 
         (request.requestBody && looksLikeGraphQL(request.requestBody));
};

const looksLikeGraphQL = (requestBody: any): boolean => {
  if (!requestBody) return false;
  
  try {
    const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
    const body = typeof requestBody === 'object' ? requestBody : JSON.parse(bodyStr);
    
    // Check for GraphQL query patterns
    return !!(body.query || body.operationName || body.variables || 
              bodyStr.includes('query ') || bodyStr.includes('mutation ') || 
              bodyStr.includes('subscription '));
  } catch {
    return false;
  }
};

const extractGraphQLOperation = (request: NetworkRequest): string | null => {
  if (!request.requestBody) return null;
  
  try {
    const bodyStr = typeof request.requestBody === 'string' ? request.requestBody : JSON.stringify(request.requestBody);
    const body = typeof request.requestBody === 'object' ? request.requestBody : JSON.parse(bodyStr);
    
    // Priority 1: Use operationName if available
    if (body.operationName && typeof body.operationName === 'string') {
      return body.operationName;
    }
    
    // Priority 2: Extract operation name from query string
    if (body.query && typeof body.query === 'string') {
      const queryMatch = body.query.match(/(?:query|mutation|subscription)\s+([a-zA-Z][a-zA-Z0-9_]*)/);
      if (queryMatch && queryMatch[1]) {
        return queryMatch[1];
      }
      
      // Priority 3: Use operation type + hash for unnamed operations
      const operationType = body.query.trim().match(/^(query|mutation|subscription)/);
      if (operationType) {
        const queryHash = simpleHash(body.query);
        return `${operationType[1]}_${queryHash}`;
      }
    }
    
    // Priority 4: Fallback to request body hash
    const bodyHash = simpleHash(bodyStr);
    return `operation_${bodyHash}`;
    
  } catch (error) {
    return null;
  }
};

const simpleHash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).substring(0, 8);
};

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

const categoryIcons: Record<string, string> = {
  Auth: '🔐', CRUD: '📦', Search: '🔍', Upload: '📤', Webhook: '🔔',
  Admin: '⚙️', Health: '💚', Streaming: '📡', GraphQL: '◈', Other: '📋',
};

const EndpointPreview: React.FC<EndpointPreviewProps> = ({
  session,
  showDetails = false,
  excludedEndpoints = new Set(),
  onEndpointToggle
}) => {
  const [viewMode, setViewMode] = useState<'flat' | 'grouped'>('flat');

  const groupedEndpoints = useMemo(() => {
    if (viewMode !== 'grouped') return [];
    return EndpointGrouper.getInstance().groupEndpoints(session.requests);
  }, [session.requests, viewMode]);
  const endpointAnalysis = useMemo(() => {
    const endpointMap = new Map<string, EndpointInfo>();
    
    session.requests.forEach(req => {
      try {
        const url = new URL(req.url);
        let signature = `${req.method}:${normalizePath(url.pathname)}`;
        let displayPath = normalizePath(url.pathname);
        
        // ENHANCED: Special handling for GraphQL endpoints
        if (isGraphQLEndpoint(url.pathname, req)) {
          const graphqlOperation = extractGraphQLOperation(req);
          if (graphqlOperation) {
            signature = `${req.method}:${url.pathname}:${graphqlOperation}`;
            displayPath = `${url.pathname}:${graphqlOperation}`;
          }
        }
        
        if (endpointMap.has(signature)) {
          const existing = endpointMap.get(signature)!;
          existing.count++;
          if (req.status && !existing.statusCodes.includes(req.status)) {
            existing.statusCodes.push(req.status);
          }
        } else {
          endpointMap.set(signature, {
            method: req.method,
            path: displayPath,
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
      <Box display="flex" alignItems="center" gap={1} mb={2} flexWrap="wrap">
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
        <Box sx={{ ml: 'auto' }}>
          <Chip
            icon={viewMode === 'flat' ? <ViewList sx={{ fontSize: 16 }} /> : <AccountTree sx={{ fontSize: 16 }} />}
            label={viewMode === 'flat' ? 'Flat' : 'Grouped'}
            size="small"
            variant="outlined"
            onClick={() => setViewMode(viewMode === 'flat' ? 'grouped' : 'flat')}
            sx={{ cursor: 'pointer' }}
          />
        </Box>
      </Box>

      {viewMode === 'grouped' && groupedEndpoints.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {groupedEndpoints.map((group, idx) => (
            <Accordion key={idx} defaultExpanded={groupedEndpoints.length <= 5}>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                  <Typography sx={{ fontSize: 16 }}>{categoryIcons[group.category] || '📋'}</Typography>
                  <Typography variant="subtitle2">{group.resource}</Typography>
                  <Chip label={group.category} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                  {group.isCrud && (
                    <Chip label="CRUD" size="small" color="success" sx={{ height: 20, fontSize: 11 }} />
                  )}
                  <Chip label={`${group.requestCount} req`} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                <List dense sx={{ py: 0 }}>
                  {group.endpoints.map((ep, epIdx) => (
                    <ListItem key={epIdx} sx={{ px: 0, py: 0.25 }}>
                      <ListItemText
                        primary={
                          <Box display="flex" alignItems="center" gap={0.5}>
                            <Chip label={ep.method} size="small" color={getMethodColor(ep.method) as any} sx={{ minWidth: 55, height: 22 }} />
                            <Typography variant="body2" component="code" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                              {ep.path}
                            </Typography>
                            {ep.count > 1 && <Chip label={`${ep.count}x`} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />}
                            {ep.statuses.map(s => (
                              <Chip key={s} label={s} size="small" color={getStatusColor(s) as any} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                            ))}
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
      )}

      {viewMode === 'flat' && showDetails ? (
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
      ) : viewMode === 'flat' ? (
        // Compact view
        <Box>
          {/* Active Endpoints */}
          <Box display="flex" flexWrap="wrap" gap={1} mb={excludedCount > 0 ? 2 : 0}>
            {activeEndpoints.map((endpoint, index) => (
              <Tooltip
                key={index}
                title={
                  <Box sx={{ color: '#fff' }}>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'inherit' }}>
                      {endpoint.method} {endpoint.path}
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ color: 'inherit' }}>
                      Domain: {endpoint.domain}
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ color: 'inherit' }}>
                      Requests: {endpoint.count}
                    </Typography>
                    <Typography variant="caption" display="block" sx={{ color: 'inherit' }}>
                      Status codes: {endpoint.statusCodes.join(', ')}
                    </Typography>
                    {onEndpointToggle && (
                      <Typography variant="caption" display="block" sx={{ mt: 0.5, fontStyle: 'italic', color: 'rgba(255,255,255,0.7)' }}>
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
                        <Box sx={{ color: '#fff' }}>
                          <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'inherit' }}>
                            {endpoint.method} {endpoint.path}
                          </Typography>
                          <Typography variant="caption" display="block" sx={{ color: 'rgba(255,255,255,0.7)' }}>
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
      ) : null}

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
