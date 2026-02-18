import React, { useState } from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  Alert,
  Paper,
} from '@mui/material';
import {
  ExpandMore,
  CompareArrows,
  Add,
  Remove,
  Edit,
  CheckCircle,
} from '@mui/icons-material';
import { RecordingSession, SessionDiffResult, EndpointDiff } from '@/types';
import { SessionDiffService } from '@/services/SessionDiffService';

interface SessionDiffPanelProps {
  sessions: RecordingSession[];
}

export default function SessionDiffPanel({ sessions }: SessionDiffPanelProps) {
  const [sessionAId, setSessionAId] = useState<string>('');
  const [sessionBId, setSessionBId] = useState<string>('');
  const [diffResult, setDiffResult] = useState<SessionDiffResult | null>(null);
  const [comparing, setComparing] = useState(false);

  const handleCompare = () => {
    const sessionA = sessions.find(s => s.id === sessionAId);
    const sessionB = sessions.find(s => s.id === sessionBId);
    if (!sessionA || !sessionB) return;

    setComparing(true);
    try {
      const result = SessionDiffService.getInstance().diff(sessionA, sessionB);
      setDiffResult(result);
    } finally {
      setComparing(false);
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const renderEndpointList = (endpoints: EndpointDiff[], icon: React.ReactNode, emptyText: string) => {
    if (endpoints.length === 0) {
      return <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>{emptyText}</Typography>;
    }

    return (
      <List dense sx={{ py: 0 }}>
        {endpoints.map((ep, i) => (
          <ListItem key={i} sx={{ px: 0, py: 0.25 }}>
            <ListItemText
              primary={
                <Box display="flex" alignItems="center" gap={0.5} flexWrap="wrap">
                  {icon}
                  <Chip label={ep.method} size="small" sx={{ height: 20, fontSize: 10 }} />
                  <Typography variant="body2" component="code" sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                    {ep.path}
                  </Typography>
                  {ep.countA !== undefined && ep.countB !== undefined && (
                    <Typography variant="caption" color="text.secondary">
                      ({ep.countA} &rarr; {ep.countB} calls)
                    </Typography>
                  )}
                </Box>
              }
              secondary={ep.changes && (
                <Box sx={{ mt: 0.5, pl: 3 }}>
                  {ep.changes.statusCodeChanged && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Status: {ep.changes.statusCodeChanged.from.join(', ')} &rarr; {ep.changes.statusCodeChanged.to.join(', ')}
                    </Typography>
                  )}
                  {ep.changes.durationChanged && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Duration: {formatDuration(ep.changes.durationChanged.from)} &rarr; {formatDuration(ep.changes.durationChanged.to)}
                    </Typography>
                  )}
                  {ep.changes.responseSchemaChanged && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Schema: {ep.changes.responseSchemaChanged.addedKeys.length > 0 && `+${ep.changes.responseSchemaChanged.addedKeys.join(', ')}`}
                      {ep.changes.responseSchemaChanged.addedKeys.length > 0 && ep.changes.responseSchemaChanged.removedKeys.length > 0 && ' '}
                      {ep.changes.responseSchemaChanged.removedKeys.length > 0 && `-${ep.changes.responseSchemaChanged.removedKeys.join(', ')}`}
                    </Typography>
                  )}
                </Box>
              )}
            />
          </ListItem>
        ))}
      </List>
    );
  };

  if (sessions.length < 2) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography color="text.secondary">
          Need at least 2 sessions to compare
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Session Comparison
      </Typography>

      {/* Session Selectors */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
        <FormControl fullWidth size="small">
          <InputLabel>Session A</InputLabel>
          <Select
            value={sessionAId}
            onChange={(e) => { setSessionAId(e.target.value); setDiffResult(null); }}
            label="Session A"
          >
            {sessions.map(s => (
              <MenuItem key={s.id} value={s.id} disabled={s.id === sessionBId}>
                {s.name} ({s.requests.length} req)
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <CompareArrows color="action" />

        <FormControl fullWidth size="small">
          <InputLabel>Session B</InputLabel>
          <Select
            value={sessionBId}
            onChange={(e) => { setSessionBId(e.target.value); setDiffResult(null); }}
            label="Session B"
          >
            {sessions.map(s => (
              <MenuItem key={s.id} value={s.id} disabled={s.id === sessionAId}>
                {s.name} ({s.requests.length} req)
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Button
        variant="contained"
        onClick={handleCompare}
        disabled={!sessionAId || !sessionBId || sessionAId === sessionBId || comparing}
        fullWidth
        sx={{ mb: 2 }}
      >
        {comparing ? 'Comparing...' : 'Compare Sessions'}
      </Button>

      {/* Results */}
      {diffResult && (
        <Box>
          {/* Summary Chips */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            <Chip label={`${diffResult.summary.added} added`} size="small" color="success" />
            <Chip label={`${diffResult.summary.removed} removed`} size="small" color="error" />
            <Chip label={`${diffResult.summary.modified} modified`} size="small" color="warning" />
            <Chip label={`${diffResult.summary.unchanged} unchanged`} size="small" variant="outlined" />
          </Box>

          {/* Added */}
          {diffResult.added.length > 0 && (
            <Accordion defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Add sx={{ color: 'success.main', fontSize: 18 }} />
                  <Typography variant="subtitle2">Added ({diffResult.added.length})</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                {renderEndpointList(diffResult.added, <Add sx={{ color: 'success.main', fontSize: 14 }} />, 'No new endpoints')}
              </AccordionDetails>
            </Accordion>
          )}

          {/* Removed */}
          {diffResult.removed.length > 0 && (
            <Accordion defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Remove sx={{ color: 'error.main', fontSize: 18 }} />
                  <Typography variant="subtitle2">Removed ({diffResult.removed.length})</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                {renderEndpointList(diffResult.removed, <Remove sx={{ color: 'error.main', fontSize: 14 }} />, 'No removed endpoints')}
              </AccordionDetails>
            </Accordion>
          )}

          {/* Modified */}
          {diffResult.modified.length > 0 && (
            <Accordion defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box display="flex" alignItems="center" gap={1}>
                  <Edit sx={{ color: 'warning.main', fontSize: 18 }} />
                  <Typography variant="subtitle2">Modified ({diffResult.modified.length})</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                {renderEndpointList(diffResult.modified, <Edit sx={{ color: 'warning.main', fontSize: 14 }} />, 'No modified endpoints')}
              </AccordionDetails>
            </Accordion>
          )}

          {/* Unchanged */}
          {diffResult.unchanged.length > 0 && (
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box display="flex" alignItems="center" gap={1}>
                  <CheckCircle sx={{ color: 'text.secondary', fontSize: 18 }} />
                  <Typography variant="subtitle2" color="text.secondary">Unchanged ({diffResult.unchanged.length})</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0 }}>
                {renderEndpointList(diffResult.unchanged, <CheckCircle sx={{ color: 'text.disabled', fontSize: 14 }} />, '')}
              </AccordionDetails>
            </Accordion>
          )}
        </Box>
      )}
    </Box>
  );
}
