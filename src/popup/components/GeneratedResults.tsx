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
import CheckCircle from '@mui/icons-material/CheckCircle';
import ContentCopy from '@mui/icons-material/ContentCopy';
import Download from '@mui/icons-material/Download';
import Api from '@mui/icons-material/Api';
import AccountTree from '@mui/icons-material/AccountTree';
import VpnKey from '@mui/icons-material/VpnKey';
import Security from '@mui/icons-material/Security';
import { CodeBlock } from './CodeBlock';
import { RecordingSession, GeneratedTest } from '@/types';
import { getEndpointSignature } from '@/services/EndpointGrouper';

// Map each framework to its correct file extension + MIME type. Postman exports
// are JSON collections (not JS), REST Assured is Java, Python frameworks are
// .py, etc. — downloading everything as .js produced unusable files.
const FRAMEWORK_FILE: Record<string, { ext: string; mime: string }> = {
  jest:          { ext: 'test.js',     mime: 'text/javascript' },
  'mocha-chai':  { ext: 'test.js',     mime: 'text/javascript' },
  mocha:         { ext: 'test.js',     mime: 'text/javascript' },
  supertest:     { ext: 'test.js',     mime: 'text/javascript' },
  puppeteer:     { ext: 'test.js',     mime: 'text/javascript' },
  pactum:        { ext: 'test.js',     mime: 'text/javascript' },
  k6:            { ext: 'js',          mime: 'text/javascript' },
  cypress:       { ext: 'cy.js',       mime: 'text/javascript' },
  playwright:    { ext: 'spec.ts',     mime: 'text/typescript' },
  vitest:        { ext: 'test.ts',     mime: 'text/typescript' },
  postman:       { ext: 'postman.json', mime: 'application/json' },
  restassured:   { ext: 'java',        mime: 'text/x-java-source' },
  karate:        { ext: 'feature',     mime: 'text/plain' },
  artillery:     { ext: 'yml',         mime: 'text/yaml' },
  pytest:        { ext: 'py',          mime: 'text/x-python' },
  httpx:         { ext: 'py',          mime: 'text/x-python' },
};

const fileInfoForFramework = (framework: string): { ext: string; mime: string } =>
  FRAMEWORK_FILE[framework] || { ext: 'test.js', mime: 'text/javascript' };

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
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleCopyToClipboard = async () => {
    await navigator.clipboard.writeText(generatedCode);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  const downloadBlob = (content: string, filename: string, mime = 'text/plain') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownload = () => {
    const { ext, mime } = fileInfoForFramework(framework);
    downloadBlob(generatedCode, `test-${session.id}.${ext}`, mime);
  };

  // Derive companion artifacts from the same captured session. The generators
  // already run in the background service worker; here we just trigger them and
  // download the result. `content` covers OpenAPI/GraphQL/env; the security
  // report returns its body under `testCode`.
  const handleExportArtifact = async (
    type: 'EXPORT_OPENAPI' | 'EXPORT_GRAPHQL_SCHEMA' | 'EXPORT_ENV_FILE' | 'EXPORT_SECURITY_REPORT',
    filename: string,
    mime = 'text/plain'
  ) => {
    setExporting(type);
    setExportError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        type,
        payload: { sessionId: session.id, framework },
      });
      if (!response?.success) {
        throw new Error(response?.error || 'Export failed');
      }
      const content = response.content ?? response.testCode ?? '';
      if (!content) {
        throw new Error('Nothing to export for this session');
      }
      downloadBlob(content, filename, mime);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(null);
    }
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

        <CodeBlock code={generatedCode} maxHeight={300} />

        {/* Companion artifacts derived from the same captured session */}
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
            Export artifacts from this session
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Api fontSize="small" />}
              disabled={exporting !== null}
              onClick={() => handleExportArtifact('EXPORT_OPENAPI', `openapi-${session.id}.json`, 'application/json')}
            >
              {exporting === 'EXPORT_OPENAPI' ? 'Exporting…' : 'OpenAPI Spec'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AccountTree fontSize="small" />}
              disabled={exporting !== null}
              onClick={() => handleExportArtifact('EXPORT_GRAPHQL_SCHEMA', `schema-${session.id}.graphql`)}
            >
              {exporting === 'EXPORT_GRAPHQL_SCHEMA' ? 'Exporting…' : 'GraphQL Schema'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<VpnKey fontSize="small" />}
              disabled={exporting !== null}
              onClick={() => handleExportArtifact('EXPORT_ENV_FILE', `env-${session.id}.env`)}
            >
              {exporting === 'EXPORT_ENV_FILE' ? 'Exporting…' : '.env File'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="warning"
              startIcon={<Security fontSize="small" />}
              disabled={exporting !== null}
              onClick={() => {
                const { ext, mime } = fileInfoForFramework(framework);
                handleExportArtifact('EXPORT_SECURITY_REPORT', `security-tests-${session.id}.${ext}`, mime);
              }}
            >
              {exporting === 'EXPORT_SECURITY_REPORT' ? 'Exporting…' : 'Security Tests'}
            </Button>
          </Box>
          {exportError && (
            <Alert severity="error" sx={{ mt: 1, fontSize: '0.8rem' }} onClose={() => setExportError(null)}>
              {exportError}
            </Alert>
          )}
        </Box>

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
              label={`Quality Score: ${latestTest?.qualityScore ?? 0}/10`}
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
                  label={`Validation: ${latestTest.validation.overallScore}/10`}
                  size="small"
                  color={latestTest.validation.overallScore >= 7 ? 'success' : latestTest.validation.overallScore >= 4 ? 'warning' : 'error'}
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
                {latestTest.validation.autoFixApplied && (
                  <Chip
                    label={
                      latestTest.validation.scoreBeforeAutoFix !== undefined
                        ? `Auto-fixed ${latestTest.validation.issuesAutoFixed ?? 0} · ${latestTest.validation.scoreBeforeAutoFix}→${latestTest.validation.overallScore}`
                        : `Auto-fixed ${latestTest.validation.issuesAutoFixed ?? 0}`
                    }
                    size="small"
                    color="success"
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
