import React from 'react';
import { Box, Chip, Typography, Collapse, Alert } from '@mui/material';
import ExpandMore from '@mui/icons-material/ExpandMore';

// Shape of a single active-scan finding (extracted from GeneratePanel — plan.md 3.7).
export interface SecurityFinding {
  testName: string;
  status: string;
  details: string;
  responseStatus: number;
  severity?: string;
  description?: string;
  owaspReference?: string;
  method?: string;
  url?: string;
  payload?: string;
  evidence?: string;
  confidence?: string;
  remediation?: string;
}

interface SecurityFindingsProps {
  results: SecurityFinding[];
  expanded: number | null;
  onToggle: (index: number | null) => void;
}

/**
 * Renders the collapsible list of security-scan findings. Presentational only —
 * all state lives in the parent. (plan.md 3.7)
 */
export function SecurityFindings({ results, expanded, onToggle }: SecurityFindingsProps) {
  if (results.length === 0) return null;
  return (
    <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
      {results.map((r, i) => {
        const sevColor = r.severity === 'critical' || r.severity === 'high'
          ? 'error'
          : r.severity === 'medium' ? 'warning' : 'default';
        const isOpen = expanded === i;
        return (
          <Box key={i} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              aria-label={`${r.status} finding: ${r.testName}. Toggle details.`}
              onClick={() => onToggle(isOpen ? null : i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggle(isOpen ? null : i);
                }
              }}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.5, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}
            >
              <Chip
                label={r.status}
                size="small"
                color={r.status === 'vulnerable' ? 'error' : r.status === 'safe' ? 'success' : 'default'}
                sx={{ height: 18, fontSize: '0.6rem', minWidth: 70 }}
              />
              {r.status === 'vulnerable' && r.severity && (
                <Chip label={r.severity} size="small" color={sevColor as any} variant="outlined" sx={{ height: 18, fontSize: '0.55rem' }} />
              )}
              <Typography variant="caption" sx={{ flex: 1 }} noWrap>{r.testName}</Typography>
              {r.confidence && r.status === 'vulnerable' && (
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem' }}>
                  {r.confidence} conf
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">{r.responseStatus || '-'}</Typography>
              <ExpandMore sx={{ fontSize: 16, transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
            </Box>
            <Collapse in={isOpen}>
              <Box sx={{ pl: 1, pr: 1, pb: 1, fontSize: '0.7rem' }}>
                {r.description && (
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>{r.description}</Typography>
                )}
                {(r.method || r.url) && (
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    <strong>Endpoint:</strong> {r.method} {r.url}
                  </Typography>
                )}
                {r.payload && (
                  <Box sx={{ my: 0.5 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>Payload sent:</Typography>
                    <Box component="pre" sx={{ m: 0, p: 0.5, bgcolor: 'grey.100', borderRadius: 0.5, overflow: 'auto', fontSize: '0.65rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {r.payload}
                    </Box>
                  </Box>
                )}
                {r.evidence && (
                  <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>
                    <strong>Why flagged:</strong> {r.evidence}
                  </Typography>
                )}
                {r.owaspReference && (
                  <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    <strong>OWASP:</strong> {r.owaspReference}
                  </Typography>
                )}
                {r.remediation && (
                  <Alert severity="info" sx={{ mt: 0.5, py: 0, fontSize: '0.65rem' }}>
                    <strong>Fix:</strong> {r.remediation}
                  </Alert>
                )}
              </Box>
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}
