import React from 'react';
import {
  Box,
  Paper,
  Typography,
} from '@mui/material';
import { AttachMoney } from '@mui/icons-material';
import { RecordingSession, AIProvider, AIModel } from '@/types';
import { getEndpointSignature } from '@/services/EndpointGrouper';

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

// Per-model cost per 1K tokens (input/output)
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'gpt-4.1':           { input: 0.002,    output: 0.008 },
  'gpt-4.1-mini':      { input: 0.0004,   output: 0.0016 },
  'claude-4-5-opus':   { input: 0.015,    output: 0.075 },
  'claude-4-5-sonnet': { input: 0.003,    output: 0.015 },
  'claude-4-sonnet':   { input: 0.003,    output: 0.015 },
  'claude-3-7-sonnet': { input: 0.003,    output: 0.015 },
  'gemini-2-5-pro':    { input: 0.00125,  output: 0.01 },
  'gemini-2-5-flash':  { input: 0.00015,  output: 0.0035 },
  'llama-3.2':         { input: 0,        output: 0 },
  'deepseek-coder':    { input: 0,        output: 0 },
};

// Blended rate: 70% input tokens, 30% output tokens (typical for code generation)
function getBlendedRate(model: AIModel): number {
  const costs = MODEL_COSTS[model];
  if (!costs) return 0;
  return costs.input * 0.7 + costs.output * 0.3;
}

interface CostEstimatorProps {
  session: RecordingSession;
  provider: AIProvider;
  model: AIModel;
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
  model: AIModel,
  options: CostEstimatorProps['options'],
  excludedEndpoints: Set<string>,
): { cost: number; endpointCount: number; estimatedTokens: number } {
  const uniqueEndpoints = new Set<string>();
  session.requests.forEach(request => {
    const sig = getEndpointSignature(request);
    if (!excludedEndpoints.has(sig)) {
      uniqueEndpoints.add(sig);
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
  const costPer1K = getBlendedRate(model);
  const cost = (totalTokens / 1000) * costPer1K;

  return { cost, endpointCount, estimatedTokens: Math.round(totalTokens) };
}

export default function CostEstimator({ session, provider, model, options, excludedEndpoints }: CostEstimatorProps) {
  const { cost, endpointCount, estimatedTokens } = estimateCost(session, provider, model, options, excludedEndpoints);

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
