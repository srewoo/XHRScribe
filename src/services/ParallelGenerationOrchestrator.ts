import { RecordingSession, TestFramework, GeneratedTest, GenerationOptions as AIGenerationOptions } from '@/types';
import { getEndpointSignature } from './EndpointGrouper';
import { SmartAssertionBuilder, AssertionSuggestion } from './SmartAssertionBuilder';
import { PerformanceAssertionGenerator, EndpointPerformanceProfile } from './PerformanceAssertionGenerator';
import { SchemaExtractor, OpenAPISpec } from './SchemaExtractor';
import { GraphQLSchemaInference, InferredGraphQLSchema } from './GraphQLSchemaInference';
import { ScenarioBuilder, ScenarioAnalysis } from './ScenarioBuilder';
import { DataDrivenGenerator, ParameterizedTest, DataDrivenConfig } from './DataDrivenGenerator';
import { SecurityTestGenerator, SecurityTestSuite } from './SecurityTestGenerator';
import { AutoHealingService, EndpointDiff } from './AutoHealingService';
import { EnvironmentExtractor, ExtractionResult } from './EnvironmentExtractor';
import { AIService } from './AIService';

export interface GenerationTask {
  id: string;
  type: GenerationType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: any;
  error?: string;
  startTime?: number;
  endTime?: number;
}

export type GenerationType =
  | 'assertions'
  | 'performance'
  | 'openapi'
  | 'graphql'
  | 'scenarios'
  | 'dataDriven'
  | 'security'
  | 'autoHealing'
  | 'environment'
  | 'tests';

export interface ParallelGenerationResult {
  assertions?: AssertionSuggestion[];
  performance?: EndpointPerformanceProfile[];
  openapi?: OpenAPISpec;
  graphql?: InferredGraphQLSchema;
  scenarios?: ScenarioAnalysis;
  dataDriven?: ParameterizedTest[];
  security?: SecurityTestSuite[];
  autoHealing?: EndpointDiff[];
  environment?: ExtractionResult;
  tests?: GeneratedTest[];
  timing: {
    total: number;
    byTask: Record<string, number>;
  };
  errors: Array<{ task: string; error: string }>;
}

export interface GenerationOptions {
  enableAssertions: boolean;
  enablePerformance: boolean;
  enableOpenAPI: boolean;
  enableGraphQL: boolean;
  enableScenarios: boolean;
  enableDataDriven: boolean;
  enableSecurity: boolean;
  enableAutoHealing: boolean;
  enableEnvironment: boolean;
  enableAITests?: boolean; // Generate AI-powered test scripts
  framework: TestFramework;
  maxConcurrency: number;
  excludedEndpoints?: string[]; // Endpoint signatures to exclude (e.g., "GET:/api/users")
  dataDrivenConfig?: DataDrivenConfig;
  // AI-specific options (only used when enableAITests is true)
  aiProvider?: 'openai' | 'anthropic' | 'gemini' | 'local';
  aiModel?: string;
  includeAuth?: boolean;
  includeErrorScenarios?: boolean;
  includePerformanceTests?: boolean;
  includeSecurityTests?: boolean;
  generateMockData?: boolean;
}

export type ProgressCallback = (progress: GenerationProgress) => void;

export interface GenerationProgress {
  overall: number;
  currentTask: string;
  completedTasks: string[];
  runningTasks: string[];
  pendingTasks: string[];
}

export class ParallelGenerationOrchestrator {
  private static instance: ParallelGenerationOrchestrator;
  private tasks: Map<string, GenerationTask> = new Map();
  private abortController: AbortController | null = null;

  private constructor() {}

  static getInstance(): ParallelGenerationOrchestrator {
    if (!ParallelGenerationOrchestrator.instance) {
      ParallelGenerationOrchestrator.instance = new ParallelGenerationOrchestrator();
    }
    return ParallelGenerationOrchestrator.instance;
  }

  async generateAll(
    session: RecordingSession,
    options: GenerationOptions,
    onProgress?: ProgressCallback
  ): Promise<ParallelGenerationResult> {
    const startTime = Date.now();
    this.abortController = new AbortController();
    this.tasks.clear();

    // Filter out excluded endpoints from session before processing
    if (options.excludedEndpoints && options.excludedEndpoints.length > 0) {
      const excludedSet = new Set(options.excludedEndpoints);
      const filteredRequests = session.requests.filter(req => {
        return !excludedSet.has(getEndpointSignature(req));
      });
      session = { ...session, requests: filteredRequests };
    }

    const result: ParallelGenerationResult = {
      timing: { total: 0, byTask: {} },
      errors: []
    };

    // Build task list based on options
    const taskConfigs: Array<{ type: GenerationType; enabled: boolean }> = [
      { type: 'tests', enabled: options.enableAITests ?? true }, // AI test generation (default: enabled)
      { type: 'environment', enabled: options.enableEnvironment },
      { type: 'assertions', enabled: options.enableAssertions },
      { type: 'performance', enabled: options.enablePerformance },
      { type: 'openapi', enabled: options.enableOpenAPI },
      { type: 'graphql', enabled: options.enableGraphQL },
      { type: 'scenarios', enabled: options.enableScenarios },
      { type: 'dataDriven', enabled: options.enableDataDriven },
      { type: 'security', enabled: options.enableSecurity },
      { type: 'autoHealing', enabled: options.enableAutoHealing }
    ];

    const enabledTasks = taskConfigs.filter(t => t.enabled).map(t => t.type);

    // Initialize tasks
    enabledTasks.forEach(type => {
      this.tasks.set(type, {
        id: type,
        type,
        status: 'pending',
        progress: 0
      });
    });

    // Report initial progress
    this.reportProgress(onProgress);

    // Process tasks in parallel batches
    const batches = this.createBatches(enabledTasks, options.maxConcurrency);

    for (const batch of batches) {
      if (this.abortController.signal.aborted) break;

      const batchPromises = batch.map(taskType =>
        this.executeTask(taskType, session, options, result, onProgress)
      );

      await Promise.allSettled(batchPromises);
    }

    // Calculate timing
    result.timing.total = Date.now() - startTime;

    return result;
  }

  private createBatches(tasks: GenerationType[], maxConcurrency: number): GenerationType[][] {
    const batches: GenerationType[][] = [];
    for (let i = 0; i < tasks.length; i += maxConcurrency) {
      batches.push(tasks.slice(i, i + maxConcurrency));
    }
    return batches;
  }

  private async executeTask(
    type: GenerationType,
    session: RecordingSession,
    options: GenerationOptions,
    result: ParallelGenerationResult,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const task = this.tasks.get(type)!;
    task.status = 'running';
    task.startTime = Date.now();
    this.reportProgress(onProgress);

    try {
      switch (type) {
        case 'tests':
          result.tests = await this.runAITestGeneration(session, options, task, onProgress);
          break;

        case 'environment':
          result.environment = await this.runEnvironmentExtraction(session, task, onProgress);
          break;

        case 'assertions':
          result.assertions = await this.runAssertionGeneration(session, options.framework, task, onProgress);
          break;

        case 'performance':
          result.performance = await this.runPerformanceAnalysis(session, task, onProgress);
          break;

        case 'openapi':
          result.openapi = await this.runOpenAPIGeneration(session, task, onProgress);
          break;

        case 'graphql':
          result.graphql = await this.runGraphQLInference(session, task, onProgress);
          break;

        case 'scenarios':
          result.scenarios = await this.runScenarioBuilding(session, task, onProgress);
          break;

        case 'dataDriven':
          result.dataDriven = await this.runDataDrivenGeneration(
            session,
            options.dataDrivenConfig || this.getDefaultDataDrivenConfig(),
            task,
            onProgress
          );
          break;

        case 'security':
          result.security = await this.runSecurityGeneration(session, task, onProgress);
          break;

        case 'autoHealing':
          result.autoHealing = await this.runAutoHealingAnalysis(session, task, onProgress);
          break;
      }

      task.status = 'completed';
      task.progress = 100;
      task.endTime = Date.now();
      result.timing.byTask[type] = task.endTime - task.startTime!;

    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : 'Unknown error';
      task.endTime = Date.now();
      result.errors.push({ task: type, error: task.error });
    }

    this.reportProgress(onProgress);
  }

  private async runAITestGeneration(
    session: RecordingSession,
    options: GenerationOptions,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<GeneratedTest[]> {
    task.progress = 10;
    this.reportProgress(onProgress);

    const aiService = AIService.getInstance();

    // Build AI generation options from parallel options
    const aiOptions: AIGenerationOptions = {
      framework: options.framework,
      provider: options.aiProvider || 'openai',
      model: options.aiModel as any || 'gpt-4.1-mini',
      includeAuth: options.includeAuth ?? true,
      includeErrorScenarios: options.includeErrorScenarios ?? true,
      includePerformanceTests: options.includePerformanceTests ?? true,
      includeSecurityTests: options.includeSecurityTests ?? true,
      generateMockData: options.generateMockData ?? true,
      complexity: 'intermediate' as const
    };

    task.progress = 30;
    this.reportProgress(onProgress);

    try {
      // Generate tests using AIService
      const generatedTest = await aiService.generateTests(session, aiOptions, undefined, (current, total, stage) => {
        // Map AI progress (0-100%) to task progress (30-90%)
        const aiProgress = total > 0 ? (current / total) * 100 : 0;
        task.progress = 30 + (aiProgress * 0.6); // 30% to 90%
        this.reportProgress(onProgress);
      });

      task.progress = 100;
      this.reportProgress(onProgress);

      // Return as array for consistency
      return [generatedTest];
    } catch (error) {
      console.error('AI test generation failed:', error);
      throw error;
    }
  }

  private async runEnvironmentExtraction(
    session: RecordingSession,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<ExtractionResult> {
    task.progress = 50;
    this.reportProgress(onProgress);

    const extractor = EnvironmentExtractor.getInstance();
    const result = extractor.extractVariables(session);

    task.progress = 100;
    return result;
  }

  private async runAssertionGeneration(
    session: RecordingSession,
    framework: TestFramework,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<AssertionSuggestion[]> {
    const builder = SmartAssertionBuilder.getInstance();
    const suggestions: AssertionSuggestion[] = [];
    const total = session.requests.length;

    // Process endpoints in parallel batches
    const batchSize = 5;
    for (let i = 0; i < session.requests.length; i += batchSize) {
      const batch = session.requests.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(request => {
          // Convert to HAR entry format
          const entry = this.requestToHAREntry(request);
          return builder.analyzeAndSuggest(entry, framework);
        })
      );

      suggestions.push(...batchResults);
      task.progress = Math.round(((i + batch.length) / total) * 100);
      this.reportProgress(onProgress);
    }

    return suggestions;
  }

  private async runPerformanceAnalysis(
    session: RecordingSession,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<EndpointPerformanceProfile[]> {
    task.progress = 30;
    this.reportProgress(onProgress);

    const generator = PerformanceAssertionGenerator.getInstance();
    const profiles = generator.analyzeSession(session);

    task.progress = 100;
    return profiles;
  }

  private async runOpenAPIGeneration(
    session: RecordingSession,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<OpenAPISpec> {
    task.progress = 50;
    this.reportProgress(onProgress);

    const extractor = SchemaExtractor.getInstance();
    const spec = extractor.extractOpenAPISpec(session);

    task.progress = 100;
    return spec;
  }

  private async runGraphQLInference(
    session: RecordingSession,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<InferredGraphQLSchema> {
    task.progress = 50;
    this.reportProgress(onProgress);

    const inferrer = GraphQLSchemaInference.getInstance();
    const schema = inferrer.inferSchema(session);

    task.progress = 100;
    return schema;
  }

  private async runScenarioBuilding(
    session: RecordingSession,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<ScenarioAnalysis> {
    task.progress = 50;
    this.reportProgress(onProgress);

    const builder = ScenarioBuilder.getInstance();
    const analysis = builder.analyzeSession(session);

    task.progress = 100;
    return analysis;
  }

  private async runDataDrivenGeneration(
    session: RecordingSession,
    config: DataDrivenConfig,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<ParameterizedTest[]> {
    const generator = DataDrivenGenerator.getInstance();
    const tests: ParameterizedTest[] = [];
    const total = session.requests.length;

    // Filter requests with body (candidates for data-driven tests)
    const candidates = session.requests.filter(r => r.requestBody);

    for (let i = 0; i < candidates.length; i++) {
      const request = candidates[i];
      const test = generator.generateDataSets(request, config);
      tests.push(test);

      task.progress = Math.round(((i + 1) / candidates.length) * 100);
      this.reportProgress(onProgress);
    }

    return tests;
  }

  private async runSecurityGeneration(
    session: RecordingSession,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<SecurityTestSuite[]> {
    task.progress = 50;
    this.reportProgress(onProgress);

    const generator = SecurityTestGenerator.getInstance();
    const suites = generator.generateSecurityTests(session);

    task.progress = 100;
    return suites;
  }

  private async runAutoHealingAnalysis(
    session: RecordingSession,
    task: GenerationTask,
    onProgress?: ProgressCallback
  ): Promise<EndpointDiff[]> {
    task.progress = 30;
    this.reportProgress(onProgress);

    const service = AutoHealingService.getInstance();

    // First capture current signatures
    service.captureSignatures(session);
    task.progress = 60;
    this.reportProgress(onProgress);

    // Then detect changes from previous baseline
    const diffs = service.detectChanges(session);
    task.progress = 100;

    return diffs;
  }

  private requestToHAREntry(request: any): any {
    return {
      startedDateTime: new Date(request.timestamp || Date.now()).toISOString(),
      time: request.duration || 0,
      request: {
        method: request.method,
        url: request.url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(request.requestHeaders || {}).map(([name, value]) => ({
          name,
          value: String(value)
        })),
        queryString: [],
        headersSize: -1,
        bodySize: -1
      },
      response: {
        status: request.status || 200,
        statusText: '',
        httpVersion: 'HTTP/1.1',
        cookies: [],
        headers: Object.entries(request.responseHeaders || {}).map(([name, value]) => ({
          name,
          value: String(value)
        })),
        content: {
          size: request.responseSize || 0,
          mimeType: 'application/json',
          text: request.responseBody ? JSON.stringify(request.responseBody) : undefined
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: request.responseSize || 0
      },
      cache: {},
      timings: {
        blocked: -1,
        dns: -1,
        connect: -1,
        send: 0,
        wait: request.duration || 0,
        receive: 0,
        ssl: -1
      }
    };
  }

  private getDefaultDataDrivenConfig(): DataDrivenConfig {
    return {
      generateBoundaryTests: true,
      generateNegativeTests: true,
      generateEdgeCases: true,
      maxVariationsPerField: 5
    };
  }

  private reportProgress(callback?: ProgressCallback): void {
    if (!callback) return;

    const completed: string[] = [];
    const running: string[] = [];
    const pending: string[] = [];

    let totalProgress = 0;

    this.tasks.forEach((task, type) => {
      totalProgress += task.progress;
      switch (task.status) {
        case 'completed':
          completed.push(type);
          break;
        case 'running':
          running.push(type);
          break;
        case 'pending':
          pending.push(type);
          break;
      }
    });

    const overall = this.tasks.size > 0
      ? Math.round(totalProgress / this.tasks.size)
      : 0;

    callback({
      overall,
      currentTask: running[0] || '',
      completedTasks: completed,
      runningTasks: running,
      pendingTasks: pending
    });
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  getTaskStatus(type: GenerationType): GenerationTask | undefined {
    return this.tasks.get(type);
  }

  getAllTaskStatuses(): GenerationTask[] {
    return Array.from(this.tasks.values());
  }

  // Generate combined test code from all results
  generateCombinedTestCode(
    result: ParallelGenerationResult,
    framework: TestFramework
  ): string {
    // If AI-generated tests are available, use them as the primary output
    if (result.tests && result.tests.length > 0 && result.tests[0].code) {
      const aiGeneratedCode = result.tests[0].code;

      // Add header comments with metadata
      const header = [
        '// Combined Test Suite - Generated by XHRScribe',
        `// Framework: ${framework}`,
        `// Generated: ${new Date().toISOString()}`,
        `// Total generation time: ${result.timing.total}ms`,
        `// AI-powered with parallel analysis`,
        '',
        aiGeneratedCode
      ];

      return header.join('\n');
    }

    // Fallback: Generate combined code from individual services (old behavior)
    const lines: string[] = [];

    lines.push('// Combined Test Suite - Generated by XHRScribe');
    lines.push(`// Framework: ${framework}`);
    lines.push(`// Generated: ${new Date().toISOString()}`);
    lines.push(`// Total generation time: ${result.timing.total}ms`);
    lines.push('');

    // Imports based on framework
    lines.push(this.getFrameworkImports(framework));
    lines.push('');

    // Environment variables section
    if (result.environment) {
      lines.push('// ==================== ENVIRONMENT VARIABLES ====================');
      lines.push(result.environment.templateCode);
      lines.push('');
    }

    // Main test suite
    lines.push(`describe('API Test Suite', () => {`);
    lines.push('');

    // Performance tests
    if (result.performance && result.performance.length > 0) {
      lines.push('  // ==================== PERFORMANCE TESTS ====================');
      const perfGenerator = PerformanceAssertionGenerator.getInstance();
      lines.push(perfGenerator.generatePerformanceTestCode(result.performance, framework));
      lines.push('');
    }

    // Security tests
    if (result.security && result.security.length > 0) {
      lines.push('  // ==================== SECURITY TESTS ====================');
      const secGenerator = SecurityTestGenerator.getInstance();
      result.security.forEach(suite => {
        lines.push(secGenerator.generateSecurityTestCode(suite, framework));
      });
      lines.push('');
    }

    // Scenario tests
    if (result.scenarios && result.scenarios.scenarios.length > 0) {
      lines.push('  // ==================== SCENARIO TESTS ====================');
      const scenarioBuilder = ScenarioBuilder.getInstance();
      result.scenarios.scenarios.forEach(scenario => {
        lines.push(scenarioBuilder.generateScenarioTests(scenario, framework));
      });
      lines.push('');
    }

    // Data-driven tests
    if (result.dataDriven && result.dataDriven.length > 0) {
      lines.push('  // ==================== DATA-DRIVEN TESTS ====================');
      const ddGenerator = DataDrivenGenerator.getInstance();
      result.dataDriven.forEach(test => {
        lines.push(ddGenerator.generateParameterizedTestCode(test, framework));
      });
      lines.push('');
    }

    lines.push('});');

    // GraphQL tests (separate suite)
    if (result.graphql && (result.graphql.queries.length > 0 || result.graphql.mutations.length > 0)) {
      lines.push('');
      lines.push('// ==================== GRAPHQL TESTS ====================');
      const gqlInferrer = GraphQLSchemaInference.getInstance();
      lines.push(gqlInferrer.generateGraphQLTests(result.graphql, framework));
    }

    // Auto-healing wrapper
    if (result.autoHealing && result.autoHealing.length > 0) {
      lines.push('');
      lines.push('// ==================== AUTO-HEALING WRAPPER ====================');
      const healingService = AutoHealingService.getInstance();
      lines.push(healingService.generateSelfHealingWrapper(framework));
    }

    return lines.join('\n');
  }

  private getFrameworkImports(framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        return `import { test, expect, APIRequestContext } from '@playwright/test';`;
      case 'jest':
        return `const axios = require('axios');`;
      case 'vitest':
        return `import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';`;
      case 'cypress':
        return `/// <reference types="cypress" />`;
      case 'mocha-chai':
        return `const chai = require('chai');
const chaiHttp = require('chai-http');
const { expect } = chai;
chai.use(chaiHttp);
const axios = require('axios');`;
      case 'mocha':
        return `const assert = require('assert');
const axios = require('axios');`;
      case 'supertest':
        return `const request = require('supertest');
const express = require('express');`;
      case 'pactum':
        return `const { spec, request } = require('pactum');`;
      case 'k6':
        return `import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};`;
      case 'artillery':
        return `# Artillery Load Test Configuration
# Run with: artillery run test.yml`;
      case 'pytest':
        return `import pytest
import requests
from typing import Dict, Any, List, Optional

BASE_URL = "https://api.example.com"  # Update with actual URL`;
      case 'httpx':
        return `import pytest
import httpx
import asyncio
from typing import AsyncGenerator, Dict, Any

BASE_URL = "https://api.example.com"  # Update with actual URL`;
      case 'restassured':
        return `import io.restassured.RestAssured;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import static io.restassured.RestAssured.*;
import static org.hamcrest.Matchers.*;
import org.testng.annotations.Test;
import org.testng.annotations.BeforeClass;`;
      case 'karate':
        return `Feature: API Test Suite
# Generated by XHRscribe

Background:
  * url baseUrl
  * header Content-Type = 'application/json'`;
      case 'postman':
        return `// Postman Collection - Import this JSON into Postman`;
      case 'puppeteer':
        return `const puppeteer = require('puppeteer');
const axios = require('axios');`;
      default:
        return `const axios = require('axios');`;
    }
  }

  // Export individual artifacts
  exportOpenAPISpec(result: ParallelGenerationResult): string | null {
    if (!result.openapi) return null;
    const extractor = SchemaExtractor.getInstance();
    return extractor.exportAsJSON(result.openapi);
  }

  exportGraphQLSchema(result: ParallelGenerationResult): string | null {
    if (!result.graphql) return null;
    return result.graphql.sdl;
  }

  exportEnvironmentFile(result: ParallelGenerationResult): string | null {
    if (!result.environment) return null;
    return result.environment.envFile;
  }

  exportSecurityReport(result: ParallelGenerationResult): string {
    if (!result.security || result.security.length === 0) {
      return '# No security tests generated';
    }

    const lines: string[] = [];
    lines.push('# Security Test Report');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    let totalTests = 0;
    let criticalCount = 0;
    let highCount = 0;

    result.security.forEach(suite => {
      lines.push(`## ${suite.method} ${suite.endpoint}`);
      lines.push(`Risk Score: ${suite.riskScore}/100`);
      lines.push('');
      lines.push('### Tests:');

      suite.tests.forEach(test => {
        totalTests++;
        if (test.severity === 'critical') criticalCount++;
        if (test.severity === 'high') highCount++;

        lines.push(`- [${test.severity.toUpperCase()}] ${test.name}`);
        lines.push(`  ${test.description}`);
      });

      lines.push('');
      lines.push('### Recommendations:');
      suite.recommendations.forEach(rec => {
        lines.push(`- ${rec}`);
      });
      lines.push('');
    });

    lines.push('## Summary');
    lines.push(`- Total Tests: ${totalTests}`);
    lines.push(`- Critical: ${criticalCount}`);
    lines.push(`- High: ${highCount}`);

    return lines.join('\n');
  }
}
