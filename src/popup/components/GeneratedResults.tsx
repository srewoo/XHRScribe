import React, { useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Alert,
  Fade,
  Button,
  TextField,
  Collapse,
} from '@mui/material';
import {
  CheckCircle,
  ContentCopy,
  Download,
} from '@mui/icons-material';
import { RecordingSession, GeneratedTest } from '@/types';
import { getEndpointSignature } from '@/services/EndpointGrouper';

interface GeneratedResultsProps {
  generatedCode: string;
  session: RecordingSession;
  excludedEndpoints: Set<string>;
  generatedTests: GeneratedTest[];
  framework: string;
}

export default function GeneratedResults({
  generatedCode,
  session,
  excludedEndpoints,
  generatedTests,
  framework,
}: GeneratedResultsProps) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctedCode, setCorrectedCode] = useState('');
  const [correctionSaved, setCorrectionSaved] = useState(false);

  const handleCopyToClipboard = async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([generatedCode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-${session.id}-${framework}.js`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!generatedCode) return null;

  const latestTest = generatedTests[generatedTests.length - 1];
  const warnings = latestTest?.warnings || [];
  const hasWarnings = warnings.length > 0;
  const hasPlaceholderWarnings = warnings.some(w => w.includes('placeholder'));

  const includedCount = session.requests.filter(request => {
    return !excludedEndpoints.has(getEndpointSignature(request));
  }).length;

  return (
    <Fade in={true}>
      <Paper elevation={1} sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircle color="success" />
            <Typography variant="subtitle2">Generated Tests</Typography>
          </Box>
          <Box>
            <Tooltip title={copySuccess ? 'Copied!' : 'Copy to clipboard'}>
              <IconButton size="small" onClick={handleCopyToClipboard}>
                <ContentCopy fontSize="small" color={copySuccess ? 'success' : 'inherit'} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Download file">
              <IconButton size="small" onClick={handleDownload}>
                <Download fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Paper variant="outlined" sx={{ p: 1, bgcolor: 'grey.50', maxHeight: 300, overflow: 'auto' }}>
          <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace' }}>
            {generatedCode}
          </pre>
        </Paper>

        {/* Quality Score and Metadata */}
        <Box sx={{ mt: 2 }}>
          {latestTest?.metadata?.generationMode && (
            <Typography variant="caption" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
              {latestTest.metadata.generationMode === 'individual'
                ? 'Individual endpoint processing used for guaranteed completeness'
                : 'Batch processing used for efficiency'}
            </Typography>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              label={`Quality Score: ${latestTest?.qualityScore || 8}/10`}
              color={hasWarnings ? 'warning' : 'success'}
              size="small"
            />
            <Chip
              label={`${includedCount} endpoints processed`}
              size="small"
              variant="outlined"
            />
            {latestTest?.metadata?.generationMode && (
              <Chip
                label={`${latestTest.metadata.generationMode === 'individual' ? 'Individual' : 'Batch'} Generation`}
                size="small"
                variant="outlined"
                color={latestTest.metadata.generationMode === 'individual' ? 'primary' : 'default'}
              />
            )}
            {!hasWarnings ? (
              <Chip label="Complete & Ready to run" size="small" variant="outlined" color="success" />
            ) : hasPlaceholderWarnings ? (
              <Chip label="Incomplete Generation" size="small" color="error" variant="outlined" />
            ) : (
              <Chip label="Has Warnings" size="small" color="warning" variant="outlined" />
            )}
            {latestTest?.validation && (
              <>
                <Chip
                  label={`Validation: ${latestTest.validation.overallScore}/100`}
                  size="small"
                  color={latestTest.validation.overallScore >= 70 ? 'success' : latestTest.validation.overallScore >= 40 ? 'warning' : 'error'}
                />
                <Chip
                  label={latestTest.validation.readinessLevel}
                  size="small"
                  variant="outlined"
                  color={latestTest.validation.readinessLevel === 'production' ? 'success' : latestTest.validation.readinessLevel === 'staging' ? 'info' : 'warning'}
                />
                {latestTest.validation.criticalIssues > 0 && (
                  <Chip
                    label={`${latestTest.validation.criticalIssues} critical`}
                    size="small"
                    color="error"
                    variant="outlined"
                  />
                )}
              </>
            )}
          </Box>

          {/* Warnings */}
          {warnings.length > 0 && (
            <Box sx={{ mt: 1 }}>
              {warnings.map((warning, index) => (
                <Alert
                  key={index}
                  severity={warning.includes('placeholder') ? 'error' : 'warning'}
                  sx={{ mt: 0.5, fontSize: '0.8rem' }}
                >
                  {warning}
                </Alert>
              ))}
            </Box>
          )}

          {/* Submit Correction */}
          <Box sx={{ mt: 1 }}>
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setCorrectionOpen(!correctionOpen);
                if (!correctionOpen) setCorrectedCode(generatedCode);
              }}
            >
              {correctionOpen ? 'Cancel' : 'Submit Correction'}
            </Button>
            <Collapse in={correctionOpen}>
              <TextField
                multiline
                minRows={4}
                maxRows={10}
                fullWidth
                size="small"
                value={correctedCode}
                onChange={(e) => setCorrectedCode(e.target.value)}
                sx={{ mt: 1, fontFamily: 'monospace', fontSize: '0.75rem' }}
              />
              <Button
                size="small"
                variant="contained"
                sx={{ mt: 0.5 }}
                disabled={correctionSaved || correctedCode === generatedCode}
                onClick={async () => {
                  try {
                    const { CorrectionTracker } = await import('@/services/CorrectionTracker');
                    const tracker = CorrectionTracker.getInstance();
                    await tracker.recordCorrection(generatedCode, correctedCode, framework);
                    setCorrectionSaved(true);
                    setTimeout(() => setCorrectionSaved(false), 3000);
                  } catch {
                    // silent
                  }
                }}
              >
                {correctionSaved ? 'Saved!' : 'Save Correction'}
              </Button>
            </Collapse>
          </Box>
        </Box>
      </Paper>
    </Fade>
  );
}
