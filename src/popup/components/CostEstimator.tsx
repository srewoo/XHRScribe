import React from 'react';
import {
  Box,
  Paper,
  Typography,
} from '@mui/material';
import { AttachMoney } from '@mui/icons-material';
import { RecordingSession, AIProvider } from '@/types';

// Token estimation constants
const BASE_TOKENS_PER_ENDPOINT = 800;

const FEATURE_MULTIPLIERS = {
  includeAuth: 0.25,
  includeErrorScenarios: 0.35,
  includePerformanceTests: 0.2,
  includeSecurityTests: 0.3,
  generateMockData: 0.15,
} as const;

const COVERAGE_MULTIPLIERS: Record<string, number> = {
  exhaustive: 1.8,
  standard: 1.2,
  minimal: 0.7,
};

// Provider cost per 1K tokens
const PROVIDER_COSTS: Record<string, number> = {
  openai: 0.00015,
  anthropic: 0.00025,
  gemini: 0.000075,
  local: 0,
};

interface CostEstimatorProps {
  session: RecordingSession;
  provider: AIProvider;
  options: {
    includeAuth: boolean;
    includeErrorScenarios: boolean;
    includePerformanceTests: boolean;
    includeSecurityTests: boolean;
    generateMockData: boolean;
    testCoverage: string;
  };
  excludedEndpoints: Set<string>;
}

export function estimateCost(
  session: RecordingSession,
  provider: AIProvider,
  options: CostEstimatorProps['options'],
  excludedEndpoints: Set<string>,
): { cost: number; endpointCount: number; estimatedTokens: number } {
  const uniqueEndpoints = new Set<string>();
  session.requests.forEach(request => {
    try {
      const url = new URL(request.url);
      const signature = `${request.method}:${url.pathname}`;
      if (!excludedEndpoints.has(signature)) {
        uniqueEndpoints.add(signature);
      }
    } catch {
      const signature = `${request.method}:${request.url}`;
      if (!excludedEndpoints.has(signature)) {
        uniqueEndpoints.add(signature);
      }
    }
  });

  const endpointCount = uniqueEndpoints.size;
  if (endpointCount === 0) return { cost: 0, endpointCount: 0, estimatedTokens: 0 };

  let complexityMultiplier = 1.0;
  for (const [key, multiplier] of Object.entries(FEATURE_MULTIPLIERS)) {
    if (options[key as keyof typeof FEATURE_MULTIPLIERS]) {
      complexityMultiplier += multiplier;
    }
  }

  const coverageMultiplier = COVERAGE_MULTIPLIERS[options.testCoverage] || 1.2;
  const totalTokens = endpointCount * BASE_TOKENS_PER_ENDPOINT * complexityMultiplier * coverageMultiplier;
  const costPer1K = PROVIDER_COSTS[provider] || 0.00015;
  const cost = (totalTokens / 1000) * costPer1K;

  return { cost, endpointCount, estimatedTokens: Math.round(totalTokens) };
}

export default function CostEstimator({ session, provider, options, excludedEndpoints }: CostEstimatorProps) {
  const { cost, endpointCount, estimatedTokens } = estimateCost(session, provider, options, excludedEndpoints);

  return (
    <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <AttachMoney fontSize="small" />
        <Typography variant="subtitle2">Estimated Cost</Typography>
      </Box>
      <Typography variant="h6">${cost.toFixed(4)}</Typography>
      <Typography variant="caption" color="text.secondary">
        {excludedEndpoints.size > 0
          ? `Based on ${endpointCount} included endpoints (~${estimatedTokens.toLocaleString()} tokens)`
          : `Based on ${endpointCount} unique endpoints (~${estimatedTokens.toLocaleString()} tokens)`}
      </Typography>
    </Paper>
  );
}
