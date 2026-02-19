import React from 'react';
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  CircularProgress,
  Fade,
} from '@mui/material';
import {
  CheckCircle,
  Info,
} from '@mui/icons-material';

interface GenerationState {
  isGenerating: boolean;
  progress: number;
  stage: string;
  estimatedTime: number;
  currentEndpoint?: number;
  totalEndpoints?: number;
  endpointName?: string;
}

interface GenerationProgressProps {
  generationState: GenerationState;
}

const PROGRESS_STEPS = [
  { step: 'Analyzing API patterns', threshold: 0 },
  { step: 'Connecting to AI provider', threshold: 20 },
  { step: 'Generating test code', threshold: 40 },
  { step: 'Optimizing and validating', threshold: 60 },
  { step: 'Finalizing test suite', threshold: 80 },
];

export default function GenerationProgress({ generationState }: GenerationProgressProps) {
  if (!generationState.isGenerating) return null;

  return (
    <Fade in={true}>
      <Paper elevation={3} sx={{
        p: 3,
        mb: 2,
        background: 'linear-gradient(135deg, #2D7D7B 0%, #1A5C5A 100%)',
        color: 'white',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Shimmer effect */}
        <Box sx={{
          position: 'absolute',
          top: 0,
          left: '-100%',
          width: '200%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
          animation: 'shimmer 2s infinite',
          '@keyframes shimmer': {
            '0%': { transform: 'translateX(0)' },
            '100%': { transform: 'translateX(50%)' },
          },
        }} />

        <Box sx={{ position: 'relative', zIndex: 1 }}>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <CircularProgress size={32} sx={{ color: 'white' }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                Generating Test Suite
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {generationState.currentEndpoint && generationState.totalEndpoints
                  ? `Generating tests for endpoint ${generationState.currentEndpoint}/${generationState.totalEndpoints}`
                  : generationState.stage}
              </Typography>
              {generationState.endpointName && (
                <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.5 }}>
                  {generationState.endpointName.length > 60
                    ? `${generationState.endpointName.substring(0, 60)}...`
                    : generationState.endpointName}
                </Typography>
              )}
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
              {generationState.progress}%
            </Typography>
          </Box>

          {/* Progress bar */}
          <LinearProgress
            variant="determinate"
            value={generationState.progress}
            sx={{
              height: 10,
              borderRadius: 5,
              bgcolor: 'rgba(255,255,255,0.3)',
              '& .MuiLinearProgress-bar': {
                bgcolor: 'white',
                borderRadius: 5,
              }
            }}
          />

          {/* Estimated time */}
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mt: 2,
            p: 1.5,
            bgcolor: 'rgba(255,255,255,0.1)',
            borderRadius: 2
          }}>
            <Info fontSize="small" />
            <Typography variant="body2">
              Estimated time remaining: {generationState.estimatedTime > 0
                ? `${generationState.estimatedTime} second${generationState.estimatedTime !== 1 ? 's' : ''}`
                : 'calculating...'}
            </Typography>
          </Box>

          {/* Progress steps */}
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
              Progress Steps:
            </Typography>
            {PROGRESS_STEPS.map(({ step, threshold }) => (
              <Box key={step} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                {generationState.progress > threshold + 20 ? (
                  <CheckCircle fontSize="small" sx={{ color: 'white' }} />
                ) : generationState.progress > threshold ? (
                  <CircularProgress size={16} sx={{ color: 'white' }} />
                ) : (
                  <Box sx={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    bgcolor: 'rgba(255,255,255,0.3)',
                    border: '2px solid rgba(255,255,255,0.5)'
                  }} />
                )}
                <Typography
                  variant="body2"
                  sx={{
                    opacity: generationState.progress > threshold ? 1 : 0.6,
                    fontWeight: generationState.progress > threshold && generationState.progress <= threshold + 20 ? 'bold' : 'normal'
                  }}
                >
                  {step}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Paper>
    </Fade>
  );
}
