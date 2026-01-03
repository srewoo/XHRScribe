import { RecordingSession, NetworkRequest, TestFramework } from '@/types';

export interface DataDependency {
  sourceRequestIndex: number;
  sourceField: string;
  targetRequestIndex: number;
  targetField: string;
  extractionPath: string;
}

export interface ScenarioStep {
  index: number;
  name: string;
  request: NetworkRequest;
  dependencies: DataDependency[];
  extractedData: Record<string, string>;
  waitTime?: number;
}

export interface TestScenario {
  id: string;
  name: string;
  description: string;
  steps: ScenarioStep[];
  tags: string[];
  estimatedDuration: number;
  isAuthFlow: boolean;
}

export interface ScenarioAnalysis {
  scenarios: TestScenario[];
  dependencies: DataDependency[];
  flowChart: string;
}

export class ScenarioBuilder {
  private static instance: ScenarioBuilder;

  private constructor() {}

  static getInstance(): ScenarioBuilder {
    if (!ScenarioBuilder.instance) {
      ScenarioBuilder.instance = new ScenarioBuilder();
    }
    return ScenarioBuilder.instance;
  }

  analyzeSession(session: RecordingSession): ScenarioAnalysis {
    const dependencies = this.detectDependencies(session.requests);
    const scenarios = this.buildScenarios(session.requests, dependencies);
    const flowChart = this.generateFlowChart(scenarios);

    return {
      scenarios,
      dependencies,
      flowChart
    };
  }

  private detectDependencies(requests: NetworkRequest[]): DataDependency[] {
    const dependencies: DataDependency[] = [];

    // Extract all response data that could be used later
    const responseDataMap = new Map<number, Map<string, any>>();

    requests.forEach((request, index) => {
      if (request.responseBody) {
        const extractedData = this.extractAllFields(request.responseBody, '');
        responseDataMap.set(index, extractedData);
      }
    });

    // Check if subsequent requests use data from previous responses
    requests.forEach((request, targetIndex) => {
      if (targetIndex === 0) return;

      // Check URL parameters
      try {
        const url = new URL(request.url);
        url.searchParams.forEach((value, key) => {
          this.findValueSource(value, responseDataMap, targetIndex, `query.${key}`, dependencies);
        });

        // Check path segments for IDs
        const pathSegments = url.pathname.split('/');
        pathSegments.forEach((segment, segIndex) => {
          if (this.looksLikeId(segment)) {
            this.findValueSource(segment, responseDataMap, targetIndex, `path[${segIndex}]`, dependencies);
          }
        });
      } catch {
        // Invalid URL
      }

      // Check request headers
      if (request.requestHeaders) {
        Object.entries(request.requestHeaders).forEach(([key, value]) => {
          if (typeof value === 'string' && key.toLowerCase() !== 'content-type') {
            this.findValueSource(value, responseDataMap, targetIndex, `header.${key}`, dependencies);
          }
        });
      }

      // Check request body
      if (request.requestBody) {
        const bodyFields = this.extractAllFields(request.requestBody, 'body');
        bodyFields.forEach((value, fieldPath) => {
          if (typeof value === 'string') {
            this.findValueSource(value, responseDataMap, targetIndex, fieldPath, dependencies);
          }
        });
      }
    });

    return dependencies;
  }

  private extractAllFields(data: any, prefix: string): Map<string, any> {
    const fields = new Map<string, any>();

    if (data === null || data === undefined) {
      return fields;
    }

    if (typeof data === 'object') {
      if (Array.isArray(data)) {
        data.forEach((item, index) => {
          const itemFields = this.extractAllFields(item, `${prefix}[${index}]`);
          itemFields.forEach((v, k) => fields.set(k, v));
        });
      } else {
        Object.entries(data).forEach(([key, value]) => {
          const path = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'object') {
            const nestedFields = this.extractAllFields(value, path);
            nestedFields.forEach((v, k) => fields.set(k, v));
          } else {
            fields.set(path, value);
          }
        });
      }
    } else {
      fields.set(prefix, data);
    }

    return fields;
  }

  private findValueSource(
    value: string,
    responseDataMap: Map<number, Map<string, any>>,
    targetIndex: number,
    targetField: string,
    dependencies: DataDependency[]
  ): void {
    // Check all previous responses
    for (let sourceIndex = 0; sourceIndex < targetIndex; sourceIndex++) {
      const sourceData = responseDataMap.get(sourceIndex);
      if (!sourceData) continue;

      sourceData.forEach((sourceValue, sourcePath) => {
        if (String(sourceValue) === value && this.isSignificantValue(value)) {
          dependencies.push({
            sourceRequestIndex: sourceIndex,
            sourceField: sourcePath,
            targetRequestIndex: targetIndex,
            targetField,
            extractionPath: sourcePath
          });
        }
      });
    }
  }

  private isSignificantValue(value: string): boolean {
    // Filter out common non-significant values
    if (value.length < 3) return false;
    if (['true', 'false', 'null', 'undefined'].includes(value.toLowerCase())) return false;
    if (/^\d{1,2}$/.test(value)) return false; // Small numbers
    return true;
  }

  private looksLikeId(value: string): boolean {
    // UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return true;
    // Numeric ID
    if (/^\d{2,}$/.test(value)) return true;
    // MongoDB ObjectId
    if (/^[0-9a-f]{24}$/i.test(value)) return true;
    return false;
  }

  private buildScenarios(requests: NetworkRequest[], dependencies: DataDependency[]): TestScenario[] {
    const scenarios: TestScenario[] = [];

    // Detect authentication flow
    const authScenario = this.detectAuthFlow(requests, dependencies);
    if (authScenario) {
      scenarios.push(authScenario);
    }

    // Detect CRUD flows
    const crudScenarios = this.detectCRUDFlows(requests, dependencies);
    scenarios.push(...crudScenarios);

    // Build general user journey scenarios
    const journeyScenarios = this.buildUserJourneys(requests, dependencies);
    scenarios.push(...journeyScenarios);

    return scenarios;
  }

  private detectAuthFlow(requests: NetworkRequest[], dependencies: DataDependency[]): TestScenario | null {
    const authPatterns = ['login', 'auth', 'signin', 'token', 'session'];

    const authRequests = requests.filter((req, index) => {
      const url = req.url.toLowerCase();
      return authPatterns.some(pattern => url.includes(pattern)) && req.method === 'POST';
    });

    if (authRequests.length === 0) return null;

    const authRequest = authRequests[0];
    const authIndex = requests.indexOf(authRequest);

    // Find requests that depend on auth token
    const dependentRequests = requests.filter((req, index) => {
      if (index <= authIndex) return false;

      // Check if it uses Authorization header
      if (req.requestHeaders?.authorization || req.requestHeaders?.Authorization) {
        return true;
      }

      // Check if there's a token dependency
      return dependencies.some(dep =>
        dep.sourceRequestIndex === authIndex &&
        dep.targetRequestIndex === index &&
        dep.sourceField.toLowerCase().includes('token')
      );
    });

    const steps: ScenarioStep[] = [
      {
        index: 0,
        name: 'Login / Authenticate',
        request: authRequest,
        dependencies: [],
        extractedData: { 'authToken': 'response.token || response.access_token' }
      },
      ...dependentRequests.slice(0, 3).map((req, idx) => ({
        index: idx + 1,
        name: this.generateStepName(req),
        request: req,
        dependencies: dependencies.filter(d => d.targetRequestIndex === requests.indexOf(req)),
        extractedData: {}
      }))
    ];

    return {
      id: `scenario-auth-${Date.now()}`,
      name: 'Authentication Flow',
      description: 'Tests the login flow and subsequent authenticated requests',
      steps,
      tags: ['auth', 'login', 'security'],
      estimatedDuration: this.calculateDuration(steps),
      isAuthFlow: true
    };
  }

  private detectCRUDFlows(requests: NetworkRequest[], dependencies: DataDependency[]): TestScenario[] {
    const scenarios: TestScenario[] = [];

    // Group requests by resource (path pattern)
    const resourceGroups = new Map<string, NetworkRequest[]>();

    requests.forEach(request => {
      try {
        const url = new URL(request.url);
        const pathParts = url.pathname.split('/').filter(Boolean);

        // Extract resource name (first non-ID segment)
        const resource = pathParts.find(p => !this.looksLikeId(p)) || 'resource';

        if (!resourceGroups.has(resource)) {
          resourceGroups.set(resource, []);
        }
        resourceGroups.get(resource)!.push(request);
      } catch {
        // Skip invalid URLs
      }
    });

    // Check each resource for CRUD patterns
    resourceGroups.forEach((resourceRequests, resource) => {
      const methods = new Set(resourceRequests.map(r => r.method));

      if (methods.has('POST') && (methods.has('GET') || methods.has('PUT') || methods.has('DELETE'))) {
        const steps: ScenarioStep[] = [];

        // Create
        const createReq = resourceRequests.find(r => r.method === 'POST');
        if (createReq) {
          steps.push({
            index: 0,
            name: `Create ${resource}`,
            request: createReq,
            dependencies: [],
            extractedData: { 'resourceId': 'response.id' }
          });
        }

        // Read
        const readReq = resourceRequests.find(r => r.method === 'GET' && r.url.includes('{id}') === false);
        if (readReq) {
          steps.push({
            index: steps.length,
            name: `Read ${resource}`,
            request: readReq,
            dependencies: createReq ? [{
              sourceRequestIndex: 0,
              sourceField: 'id',
              targetRequestIndex: steps.length,
              targetField: 'path.id',
              extractionPath: 'response.id'
            }] : [],
            extractedData: {}
          });
        }

        // Update
        const updateReq = resourceRequests.find(r => r.method === 'PUT' || r.method === 'PATCH');
        if (updateReq) {
          steps.push({
            index: steps.length,
            name: `Update ${resource}`,
            request: updateReq,
            dependencies: createReq ? [{
              sourceRequestIndex: 0,
              sourceField: 'id',
              targetRequestIndex: steps.length,
              targetField: 'path.id',
              extractionPath: 'response.id'
            }] : [],
            extractedData: {}
          });
        }

        // Delete
        const deleteReq = resourceRequests.find(r => r.method === 'DELETE');
        if (deleteReq) {
          steps.push({
            index: steps.length,
            name: `Delete ${resource}`,
            request: deleteReq,
            dependencies: createReq ? [{
              sourceRequestIndex: 0,
              sourceField: 'id',
              targetRequestIndex: steps.length,
              targetField: 'path.id',
              extractionPath: 'response.id'
            }] : [],
            extractedData: {}
          });
        }

        if (steps.length >= 2) {
          scenarios.push({
            id: `scenario-crud-${resource}-${Date.now()}`,
            name: `${this.pascalCase(resource)} CRUD Flow`,
            description: `Complete Create-Read-Update-Delete flow for ${resource}`,
            steps,
            tags: ['crud', resource],
            estimatedDuration: this.calculateDuration(steps),
            isAuthFlow: false
          });
        }
      }
    });

    return scenarios;
  }

  private buildUserJourneys(requests: NetworkRequest[], dependencies: DataDependency[]): TestScenario[] {
    const scenarios: TestScenario[] = [];

    // Find chains of dependent requests
    const chains = this.findDependencyChains(requests, dependencies);

    chains.forEach((chain, index) => {
      if (chain.length >= 3) {
        const steps = chain.map((req, idx) => ({
          index: idx,
          name: this.generateStepName(req),
          request: req,
          dependencies: dependencies.filter(d =>
            d.targetRequestIndex === requests.indexOf(req) &&
            chain.some(chainReq => requests.indexOf(chainReq) === d.sourceRequestIndex)
          ),
          extractedData: {},
          waitTime: idx > 0 ? 100 : undefined
        }));

        scenarios.push({
          id: `scenario-journey-${index}-${Date.now()}`,
          name: `User Journey ${index + 1}`,
          description: `Multi-step user flow with ${chain.length} API calls`,
          steps,
          tags: ['user-journey', 'integration'],
          estimatedDuration: this.calculateDuration(steps),
          isAuthFlow: false
        });
      }
    });

    return scenarios;
  }

  private findDependencyChains(requests: NetworkRequest[], dependencies: DataDependency[]): NetworkRequest[][] {
    const chains: NetworkRequest[][] = [];
    const visited = new Set<number>();

    requests.forEach((req, startIndex) => {
      if (visited.has(startIndex)) return;

      const chain: NetworkRequest[] = [req];
      let currentIndex = startIndex;
      visited.add(startIndex);

      // Follow dependency chain forward
      while (true) {
        const nextDep = dependencies.find(d =>
          d.sourceRequestIndex === currentIndex && !visited.has(d.targetRequestIndex)
        );

        if (!nextDep) break;

        visited.add(nextDep.targetRequestIndex);
        chain.push(requests[nextDep.targetRequestIndex]);
        currentIndex = nextDep.targetRequestIndex;
      }

      if (chain.length > 1) {
        chains.push(chain);
      }
    });

    return chains.sort((a, b) => b.length - a.length);
  }

  private generateStepName(request: NetworkRequest): string {
    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split('/').filter(Boolean);
      const resource = pathParts.find(p => !this.looksLikeId(p)) || 'resource';

      switch (request.method) {
        case 'GET':
          return `Fetch ${resource}`;
        case 'POST':
          return `Create ${resource}`;
        case 'PUT':
        case 'PATCH':
          return `Update ${resource}`;
        case 'DELETE':
          return `Delete ${resource}`;
        default:
          return `${request.method} ${resource}`;
      }
    } catch {
      return `${request.method} request`;
    }
  }

  private calculateDuration(steps: ScenarioStep[]): number {
    return steps.reduce((sum, step) => {
      return sum + (step.request.duration || 500) + (step.waitTime || 0);
    }, 0);
  }

  private pascalCase(str: string): string {
    return str
      .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
      .replace(/^(.)/, c => c.toUpperCase());
  }

  private generateFlowChart(scenarios: TestScenario[]): string {
    const lines: string[] = ['```mermaid', 'flowchart TD'];

    scenarios.forEach((scenario, sIndex) => {
      lines.push(`  subgraph ${scenario.name.replace(/\s/g, '_')}`);

      scenario.steps.forEach((step, stepIndex) => {
        const nodeId = `S${sIndex}_${stepIndex}`;
        const label = `${step.name}`;
        lines.push(`    ${nodeId}["${label}"]`);

        if (stepIndex > 0) {
          const prevNodeId = `S${sIndex}_${stepIndex - 1}`;
          const dependency = step.dependencies[0];
          const edgeLabel = dependency ? dependency.sourceField : '';
          lines.push(`    ${prevNodeId} -->|${edgeLabel}| ${nodeId}`);
        }
      });

      lines.push('  end');
    });

    lines.push('```');
    return lines.join('\n');
  }

  generateScenarioTests(scenario: TestScenario, framework: TestFramework): string {
    const lines: string[] = [];

    // Header
    lines.push(`// Scenario: ${scenario.name}`);
    lines.push(`// ${scenario.description}`);
    lines.push(`// Tags: ${scenario.tags.join(', ')}`);
    lines.push('');

    // Imports
    lines.push(this.getImports(framework));
    lines.push('');

    // Test suite
    lines.push(this.getDescribeBlock(framework, scenario.name, () => {
      const content: string[] = [];

      // Setup variables
      content.push('  // Extracted data from previous steps');
      content.push('  const scenarioData = {};');
      content.push('');

      // Generate test for each step
      scenario.steps.forEach(step => {
        content.push(this.generateStepTest(step, framework));
        content.push('');
      });

      return content.join('\n');
    }));

    return lines.join('\n');
  }

  private getImports(framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        return `import { test, expect } from '@playwright/test';`;
      case 'cypress':
        return `/// <reference types="cypress" />`;
      case 'jest':
        return `const axios = require('axios');`;
      default:
        return `const axios = require('axios');`;
    }
  }

  private getDescribeBlock(framework: TestFramework, name: string, contentFn: () => string): string {
    const content = contentFn();
    if (framework === 'playwright') {
      return `test.describe.serial('${name}', () => {\n${content}\n});`;
    }
    return `describe('${name}', () => {\n${content}\n});`;
  }

  private generateStepTest(step: ScenarioStep, framework: TestFramework): string {
    const lines: string[] = [];
    const testName = `Step ${step.index + 1}: ${step.name}`;

    switch (framework) {
      case 'playwright':
        lines.push(`  test('${testName}', async ({ request }) => {`);
        break;
      case 'cypress':
        lines.push(`  it('${testName}', () => {`);
        break;
      default:
        lines.push(`  test('${testName}', async () => {`);
    }

    // Add dependency extraction comments
    if (step.dependencies.length > 0) {
      lines.push(`    // Dependencies:`);
      step.dependencies.forEach(dep => {
        lines.push(`    // - Uses ${dep.sourceField} from step ${dep.sourceRequestIndex + 1}`);
      });
    }

    // Request execution
    try {
      const url = new URL(step.request.url);
      const method = step.request.method.toLowerCase();

      switch (framework) {
        case 'playwright':
          lines.push(`    const response = await request.${method}('${url.pathname}', {`);
          if (step.request.requestBody) {
            lines.push(`      data: ${JSON.stringify(step.request.requestBody, null, 6).split('\n').join('\n      ')}`);
          }
          lines.push(`    });`);
          lines.push(`    expect(response.ok()).toBeTruthy();`);
          break;

        case 'cypress':
          lines.push(`    cy.request('${step.request.method}', '${url.pathname}'${step.request.requestBody ? `, ${JSON.stringify(step.request.requestBody)}` : ''}).then((response) => {`);
          lines.push(`      expect(response.status).to.be.oneOf([200, 201, 204]);`);
          break;

        default:
          lines.push(`    const response = await axios.${method}('${url.pathname}'${step.request.requestBody ? `, ${JSON.stringify(step.request.requestBody)}` : ''});`);
          lines.push(`    expect(response.status).toBeLessThan(400);`);
      }

      // Data extraction
      Object.entries(step.extractedData).forEach(([varName, path]) => {
        if (framework === 'cypress') {
          lines.push(`      scenarioData['${varName}'] = response.body.${path.replace('response.', '')};`);
        } else {
          lines.push(`    const responseBody = await response.json();`);
          lines.push(`    scenarioData['${varName}'] = responseBody.${path.replace('response.', '')};`);
        }
      });

      if (framework === 'cypress') {
        lines.push(`    });`);
      }

    } catch {
      lines.push(`    // Unable to generate request for ${step.request.url}`);
    }

    lines.push(`  });`);

    return lines.join('\n');
  }
}
