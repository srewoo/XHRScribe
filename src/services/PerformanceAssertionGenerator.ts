import { HAREntry, TestFramework, RecordingSession } from '@/types';

export interface PerformanceMetrics {
  responseTime: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  stdDev: number;
}

export interface PerformanceAssertion {
  type: 'latency' | 'size' | 'throughput' | 'ttfb' | 'regression';
  assertion: string;
  threshold: number;
  unit: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface EndpointPerformanceProfile {
  endpoint: string;
  method: string;
  metrics: PerformanceMetrics;
  assertions: PerformanceAssertion[];
  recommendations: string[];
}

export interface PerformanceBaseline {
  endpoints: Map<string, PerformanceMetrics>;
  capturedAt: number;
  sessionId: string;
}

export class PerformanceAssertionGenerator {
  private static instance: PerformanceAssertionGenerator;
  private baselines: Map<string, PerformanceBaseline> = new Map();

  private constructor() {}

  static getInstance(): PerformanceAssertionGenerator {
    if (!PerformanceAssertionGenerator.instance) {
      PerformanceAssertionGenerator.instance = new PerformanceAssertionGenerator();
    }
    return PerformanceAssertionGenerator.instance;
  }

  analyzeSession(session: RecordingSession): EndpointPerformanceProfile[] {
    const endpointGroups = this.groupByEndpoint(session);
    const profiles: EndpointPerformanceProfile[] = [];

    endpointGroups.forEach((entries, key) => {
      const [method, endpoint] = key.split('::');
      const metrics = this.calculateMetrics(entries);
      const assertions = this.generateAssertions(metrics, method, endpoint);
      const recommendations = this.generateRecommendations(metrics, method);

      profiles.push({
        endpoint,
        method,
        metrics,
        assertions,
        recommendations
      });
    });

    return profiles;
  }

  private groupByEndpoint(session: RecordingSession): Map<string, HAREntry[]> {
    const groups = new Map<string, HAREntry[]>();

    session.requests.forEach(request => {
      try {
        const url = new URL(request.url);
        const key = `${request.method}::${url.pathname}`;

        // Convert to HAR entry format
        const entry: HAREntry = {
          startedDateTime: new Date(request.timestamp).toISOString(),
          time: request.duration || 0,
          request: {
            method: request.method,
            url: request.url,
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: Object.entries(request.requestHeaders || {}).map(([name, value]) => ({ name, value: String(value) })),
            queryString: [],
            headersSize: -1,
            bodySize: -1
          },
          response: {
            status: request.status || 200,
            statusText: '',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: Object.entries(request.responseHeaders || {}).map(([name, value]) => ({ name, value: String(value) })),
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

        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(entry);
      } catch {
        // Invalid URL, skip
      }
    });

    return groups;
  }

  private calculateMetrics(entries: HAREntry[]): PerformanceMetrics {
    const times = entries.map(e => e.time).filter(t => t > 0).sort((a, b) => a - b);

    if (times.length === 0) {
      return {
        responseTime: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        min: 0,
        max: 0,
        avg: 0,
        stdDev: 0
      };
    }

    const sum = times.reduce((a, b) => a + b, 0);
    const avg = sum / times.length;

    // Calculate standard deviation
    const squaredDiffs = times.map(t => Math.pow(t - avg, 2));
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / times.length;
    const stdDev = Math.sqrt(avgSquaredDiff);

    return {
      responseTime: times[0],
      p50: this.percentile(times, 50),
      p95: this.percentile(times, 95),
      p99: this.percentile(times, 99),
      min: Math.min(...times),
      max: Math.max(...times),
      avg: Math.round(avg),
      stdDev: Math.round(stdDev)
    };
  }

  private percentile(sortedValues: number[], p: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil((p / 100) * sortedValues.length) - 1;
    return sortedValues[Math.max(0, index)];
  }

  private generateAssertions(metrics: PerformanceMetrics, method: string, endpoint: string): PerformanceAssertion[] {
    const assertions: PerformanceAssertion[] = [];

    // Response time assertion (p95 + 20% buffer)
    const p95Threshold = Math.round(metrics.p95 * 1.2);
    assertions.push({
      type: 'latency',
      assertion: `expect(responseTime).toBeLessThan(${p95Threshold});`,
      threshold: p95Threshold,
      unit: 'ms',
      description: `Response time should be under ${p95Threshold}ms (p95 + 20% buffer)`,
      severity: 'high'
    });

    // Max response time assertion
    const maxThreshold = Math.round(metrics.max * 1.5);
    assertions.push({
      type: 'latency',
      assertion: `expect(responseTime).toBeLessThan(${maxThreshold});`,
      threshold: maxThreshold,
      unit: 'ms',
      description: `Response time should never exceed ${maxThreshold}ms`,
      severity: 'critical'
    });

    // P99 for critical endpoints
    if (this.isCriticalEndpoint(endpoint, method)) {
      const p99Threshold = Math.round(metrics.p99 * 1.1);
      assertions.push({
        type: 'latency',
        assertion: `expect(responseTime).toBeLessThan(${p99Threshold});`,
        threshold: p99Threshold,
        unit: 'ms',
        description: `Critical endpoint p99 should be under ${p99Threshold}ms`,
        severity: 'critical'
      });
    }

    // Standard deviation check for consistency
    if (metrics.stdDev > metrics.avg * 0.5) {
      assertions.push({
        type: 'latency',
        assertion: `// High response time variance detected - consider adding consistency checks`,
        threshold: metrics.stdDev,
        unit: 'ms',
        description: 'Response times are inconsistent (high standard deviation)',
        severity: 'medium'
      });
    }

    return assertions;
  }

  private isCriticalEndpoint(endpoint: string, method: string): boolean {
    const criticalPatterns = ['login', 'auth', 'payment', 'checkout', 'health', 'status'];
    const lowerEndpoint = endpoint.toLowerCase();
    return criticalPatterns.some(p => lowerEndpoint.includes(p)) || method === 'POST';
  }

  private generateRecommendations(metrics: PerformanceMetrics, method: string): string[] {
    const recommendations: string[] = [];

    // Slow response warning
    if (metrics.p95 > 2000) {
      recommendations.push('⚠️ P95 response time exceeds 2 seconds. Consider optimizing database queries or adding caching.');
    }

    // High variance warning
    if (metrics.stdDev > metrics.avg * 0.5) {
      recommendations.push('⚠️ High response time variance detected. Check for inconsistent load or cold starts.');
    }

    // Very fast responses (might be cached)
    if (metrics.avg < 10) {
      recommendations.push('ℹ️ Very fast responses detected. These might be cached - ensure you test cache misses too.');
    }

    // POST/PUT operations
    if ((method === 'POST' || method === 'PUT') && metrics.p95 > 1000) {
      recommendations.push('⚠️ Write operations are slow. Consider async processing or queue-based architecture.');
    }

    return recommendations;
  }

  generatePerformanceTestCode(profiles: EndpointPerformanceProfile[], framework: TestFramework): string {
    const lines: string[] = [];

    // Header
    lines.push(this.getImports(framework));
    lines.push('');
    lines.push('// Performance Test Suite - Generated by XHRScribe');
    lines.push(`// Baseline captured: ${new Date().toISOString()}`);
    lines.push('');

    // Describe block
    lines.push(this.getDescribeBlock(framework, 'API Performance Tests', () => {
      const content: string[] = [];

      // Setup
      content.push(this.getSetup(framework));
      content.push('');

      // Performance tests for each endpoint
      profiles.forEach(profile => {
        content.push(this.generateEndpointPerformanceTest(profile, framework));
        content.push('');
      });

      // Summary test
      content.push(this.generateSummaryTest(profiles, framework));

      return content.join('\n');
    }));

    return lines.join('\n');
  }

  private getImports(framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        return `import { test, expect } from '@playwright/test';`;
      case 'jest':
        return `const axios = require('axios');`;
      case 'vitest':
        return `import { describe, test, expect, beforeAll } from 'vitest';\nimport axios from 'axios';`;
      case 'cypress':
        return `/// <reference types="cypress" />`;
      default:
        return `const axios = require('axios');`;
    }
  }

  private getDescribeBlock(framework: TestFramework, name: string, contentFn: () => string): string {
    const content = contentFn();
    switch (framework) {
      case 'playwright':
        return `test.describe('${name}', () => {\n${content}\n});`;
      case 'cypress':
        return `describe('${name}', () => {\n${content}\n});`;
      default:
        return `describe('${name}', () => {\n${content}\n});`;
    }
  }

  private getSetup(framework: TestFramework): string {
    const baseUrlSetup = `  const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';`;

    switch (framework) {
      case 'playwright':
        return `${baseUrlSetup}

  test.beforeAll(async () => {
    // Warm up the API
    console.log('Warming up API endpoints...');
  });`;
      case 'cypress':
        return `${baseUrlSetup}

  before(() => {
    // Warm up the API
    cy.log('Warming up API endpoints...');
  });`;
      default:
        return `${baseUrlSetup}

  beforeAll(async () => {
    // Warm up the API
    console.log('Warming up API endpoints...');
  });`;
    }
  }

  private generateEndpointPerformanceTest(profile: EndpointPerformanceProfile, framework: TestFramework): string {
    const testName = `${profile.method} ${profile.endpoint} - Performance`;
    const lines: string[] = [];

    switch (framework) {
      case 'playwright':
        lines.push(`  test('${testName}', async ({ request }) => {`);
        lines.push(`    const startTime = Date.now();`);
        lines.push(`    const response = await request.${profile.method.toLowerCase()}(\`\${BASE_URL}${profile.endpoint}\`);`);
        lines.push(`    const responseTime = Date.now() - startTime;`);
        lines.push('');
        lines.push(`    // Baseline metrics: avg=${profile.metrics.avg}ms, p95=${profile.metrics.p95}ms, p99=${profile.metrics.p99}ms`);
        profile.assertions.forEach(a => {
          lines.push(`    ${a.assertion} // ${a.description}`);
        });
        lines.push(`  });`);
        break;

      case 'cypress':
        lines.push(`  it('${testName}', () => {`);
        lines.push(`    const startTime = Date.now();`);
        lines.push(`    cy.request('${profile.method}', \`\${BASE_URL}${profile.endpoint}\`).then((response) => {`);
        lines.push(`      const responseTime = Date.now() - startTime;`);
        lines.push('');
        lines.push(`      // Baseline metrics: avg=${profile.metrics.avg}ms, p95=${profile.metrics.p95}ms`);
        profile.assertions.forEach(a => {
          const cypressAssertion = a.assertion
            .replace('expect(', 'expect(')
            .replace('.toBeLessThan(', '.to.be.lessThan(');
          lines.push(`      ${cypressAssertion}`);
        });
        lines.push(`    });`);
        lines.push(`  });`);
        break;

      default:
        lines.push(`  test('${testName}', async () => {`);
        lines.push(`    const startTime = Date.now();`);
        lines.push(`    const response = await axios.${profile.method.toLowerCase()}(\`\${BASE_URL}${profile.endpoint}\`);`);
        lines.push(`    const responseTime = Date.now() - startTime;`);
        lines.push('');
        lines.push(`    // Baseline metrics: avg=${profile.metrics.avg}ms, p95=${profile.metrics.p95}ms, p99=${profile.metrics.p99}ms`);
        profile.assertions.forEach(a => {
          lines.push(`    ${a.assertion} // ${a.description}`);
        });
        lines.push(`  });`);
    }

    // Add recommendations as comments
    if (profile.recommendations.length > 0) {
      lines.push('');
      lines.push('  /*');
      lines.push('   * Performance Recommendations:');
      profile.recommendations.forEach(r => {
        lines.push(`   * ${r}`);
      });
      lines.push('   */');
    }

    return lines.join('\n');
  }

  private generateSummaryTest(profiles: EndpointPerformanceProfile[], framework: TestFramework): string {
    const totalEndpoints = profiles.length;
    const avgP95 = Math.round(profiles.reduce((sum, p) => sum + p.metrics.p95, 0) / totalEndpoints);

    const lines: string[] = [];
    lines.push(`  // Performance Summary`);
    lines.push(`  // Total Endpoints: ${totalEndpoints}`);
    lines.push(`  // Average P95: ${avgP95}ms`);
    lines.push('');

    switch (framework) {
      case 'playwright':
        lines.push(`  test('Overall API Performance', async () => {`);
        lines.push(`    // All endpoints should respond within acceptable thresholds`);
        lines.push(`    expect(${avgP95}).toBeLessThan(5000); // Average p95 under 5 seconds`);
        lines.push(`  });`);
        break;

      default:
        lines.push(`  test('Overall API Performance', () => {`);
        lines.push(`    // All endpoints should respond within acceptable thresholds`);
        lines.push(`    expect(${avgP95}).toBeLessThan(5000); // Average p95 under 5 seconds`);
        lines.push(`  });`);
    }

    return lines.join('\n');
  }

  // Baseline management
  captureBaseline(session: RecordingSession): PerformanceBaseline {
    const profiles = this.analyzeSession(session);
    const endpoints = new Map<string, PerformanceMetrics>();

    profiles.forEach(profile => {
      const key = `${profile.method}::${profile.endpoint}`;
      endpoints.set(key, profile.metrics);
    });

    const baseline: PerformanceBaseline = {
      endpoints,
      capturedAt: Date.now(),
      sessionId: session.id
    };

    this.baselines.set(session.id, baseline);
    return baseline;
  }

  compareWithBaseline(session: RecordingSession, baselineId: string): Map<string, { current: PerformanceMetrics; baseline: PerformanceMetrics; regression: boolean }> {
    const baseline = this.baselines.get(baselineId);
    if (!baseline) {
      throw new Error(`Baseline ${baselineId} not found`);
    }

    const currentProfiles = this.analyzeSession(session);
    const comparison = new Map<string, { current: PerformanceMetrics; baseline: PerformanceMetrics; regression: boolean }>();

    currentProfiles.forEach(profile => {
      const key = `${profile.method}::${profile.endpoint}`;
      const baselineMetrics = baseline.endpoints.get(key);

      if (baselineMetrics) {
        // Consider it a regression if p95 increased by more than 20%
        const regression = profile.metrics.p95 > baselineMetrics.p95 * 1.2;

        comparison.set(key, {
          current: profile.metrics,
          baseline: baselineMetrics,
          regression
        });
      }
    });

    return comparison;
  }
}
