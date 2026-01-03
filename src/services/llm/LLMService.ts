import { HARData, GenerationOptions, GeneratedTest, AIProvider, AIModel } from '@/types';
import { AuthFlow } from '../AuthFlowAnalyzer';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { LocalProvider } from './providers/LocalProvider';

export interface LLMProvider {
  generateTests(
    harData: HARData,
    options: GenerationOptions,
    authFlow?: AuthFlow,
    customAuthGuide?: string
  ): Promise<GeneratedTest>;
  estimateCost(tokenCount: number, model?: string): number;
  countTokens(text: string): number;
}

export class LLMService {
  private static instance: LLMService;
  private providers: Map<AIProvider, LLMProvider> = new Map();
  private cache: Map<string, GeneratedTest> = new Map();

  private constructor() {
    this.initializeProviders();
  }

  static getInstance(): LLMService {
    if (!LLMService.instance) {
      LLMService.instance = new LLMService();
    }
    return LLMService.instance;
  }

  private initializeProviders(): void {
    this.providers.set('openai', new OpenAIProvider());
    this.providers.set('anthropic', new AnthropicProvider());
    this.providers.set('gemini', new GeminiProvider());
    this.providers.set('local', new LocalProvider());
  }

  async generateTests(
    harData: HARData,
    options: GenerationOptions
  ): Promise<GeneratedTest> {
    // Check cache first
    const cacheKey = this.getCacheKey(harData, options);
    if (this.cache.has(cacheKey) && options.provider !== 'local') {
      return this.cache.get(cacheKey)!;
    }

    // Get provider
    const provider = this.providers.get(options.provider);
    if (!provider) {
      throw new Error(`Provider ${options.provider} not supported`);
    }

    // Generate tests
    const result = await provider.generateTests(harData, options);

    // Cache result
    if (options.provider !== 'local') {
      this.cache.set(cacheKey, result);
    }

    return result;
  }

  estimateCost(
    harData: HARData,
    provider: AIProvider,
    _model: AIModel
  ): { tokens: number; cost: number } {
    const llmProvider = this.providers.get(provider);
    if (!llmProvider) {
      return { tokens: 0, cost: 0 };
    }

    // Estimate tokens based on HAR data
    const harString = JSON.stringify(harData);
    const tokens = llmProvider.countTokens(harString);
    const cost = llmProvider.estimateCost(tokens);

    return { tokens, cost };
  }

  private getCacheKey(harData: HARData, options: GenerationOptions): string {
    const key = {
      entries: harData.entries.length,
      framework: options.framework,
      provider: options.provider,
      model: options.model,
      options: {
        auth: options.includeAuth,
        errors: options.includeErrorScenarios,
        perf: options.includePerformanceTests,
        security: options.includeSecurityTests,
        mock: options.generateMockData,
      },
    };
    return JSON.stringify(key);
  }

  clearCache(): void {
    this.cache.clear();
  }

  buildPrompt(harData: HARData, options: GenerationOptions): string {
    const frameworkInstructions = this.getFrameworkInstructions(options.framework);
    const testTypes = this.getTestTypeInstructions(options);
    const endpointAnalysis = this.analyzeEndpoints(harData);

    return `You are an expert API test engineer with deep knowledge of ${options.framework}.

CRITICAL REQUIREMENT: You MUST generate tests for ALL ${endpointAnalysis.totalEndpoints} unique API endpoints found in the HAR data.

ENDPOINT ANALYSIS:
${endpointAnalysis.summary}

TASK: Generate comprehensive test suites from the provided HAR data.

${frameworkInstructions}

${testTypes}

MANDATORY REQUIREMENTS:
1. Generate tests for ALL ${endpointAnalysis.totalEndpoints} unique endpoints listed above
2. Each endpoint MUST have its own complete test block
3. Use proper async/await patterns
4. Include meaningful test descriptions
5. Add proper setup and teardown
6. Use realistic test data (not production data)
7. Follow ${options.framework} best practices
8. Include proper error handling
9. Add data-driven test scenarios where applicable
10. Verify that your output covers ALL endpoints - do not skip any

VERIFICATION: Before completing, ensure you have generated tests for:
${endpointAnalysis.endpointList}

HAR DATA:
${JSON.stringify(harData, null, 2)}

Generate production-ready test code that follows best practices and includes comprehensive coverage for ALL endpoints.`;
  }

  private getFrameworkInstructions(framework: string): string {
    const instructions: Record<string, string> = {
      jest: `JEST FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`javascript
const axios = require('axios');
// OR for ES modules:
// import axios from 'axios';
\`\`\`

STRUCTURE:
- Use describe blocks for test organization
- Use beforeAll/beforeEach for setup
- Use afterAll/afterEach for cleanup
- Use expect assertions with proper matchers
- Include mock functions where appropriate
- Use async/await for API calls`,

      playwright: `PLAYWRIGHT FRAMEWORK REQUIREMENTS:
🚨 CRITICAL: NEVER use Jest syntax like describe() or it() - Only use Playwright syntax!

REQUIRED IMPORTS:
\`\`\`typescript
import { test, expect, APIRequestContext } from '@playwright/test';
\`\`\`

STRUCTURE:
- MUST use test.describe() for test organization (NOT describe())
- MUST use test() for individual tests (NOT it())
- MUST use test.beforeAll/test.beforeEach for setup
- MUST use test.afterAll/test.afterEach for cleanup
- Use { request } fixture for API testing
- Use expect() with Playwright web-first assertions

EXAMPLE:
\`\`\`typescript
test.describe('API Tests', () => {
  test('should fetch data', async ({ request }) => {
    const response = await request.get('/api/endpoint');
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toHaveProperty('id');
  });
});
\`\`\`

❌ FORBIDDEN: describe(), it(), beforeAll(), beforeEach()
✅ REQUIRED: test.describe(), test(), test.beforeAll(), test.beforeEach()`,

      'mocha-chai': `MOCHA/CHAI FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`javascript
const chai = require('chai');
const chaiHttp = require('chai-http');
const { expect } = chai;
chai.use(chaiHttp);
\`\`\`

STRUCTURE:
- Use describe blocks for test organization
- Use before/beforeEach hooks for setup
- Use after/afterEach hooks for cleanup
- Use chai expect/should assertions
- Include chai-http for API testing`,

      mocha: `MOCHA FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`javascript
const assert = require('assert');
const axios = require('axios');
\`\`\`

STRUCTURE:
- Use describe blocks for test organization
- Use before/beforeEach/after/afterEach hooks
- Use Node.js built-in assert module
- Use function() syntax for proper 'this' binding
- Include async/await for promise handling`,

      cypress: `CYPRESS FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`javascript
/// <reference types="cypress" />
\`\`\`

STRUCTURE:
- Use describe blocks for test organization
- Use beforeEach for setup
- Use cy.request() for API testing
- Use cy.intercept() for mocking
- Include proper waiting and retry strategies`,

      puppeteer: `PUPPETEER FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`javascript
const puppeteer = require('puppeteer');
const axios = require('axios');
\`\`\`

STRUCTURE:
- Use describe blocks for test organization
- Include browser and page setup/teardown
- Use page.evaluate() for in-browser API calls
- Handle navigation and API interception`,

      vitest: `VITEST FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
\`\`\`

STRUCTURE:
- Use describe blocks for test organization
- Use beforeAll/beforeEach for setup
- Use vi for mocking
- Use expect assertions
- Include parallel test execution`,

      supertest: `SUPERTEST FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`javascript
const request = require('supertest');
const express = require('express');
// OR for direct API testing:
const request = require('supertest')('https://api.example.com');
\`\`\`

STRUCTURE:
- Use describe blocks for test organization
- Use proper HTTP method chaining: request.get('/path').expect(200)
- Include status code assertions
- Add response body validations
- Chain .set() for headers`,

      pactum: `PACTUM FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`javascript
const { spec, request } = require('pactum');
// OR ES modules:
import { spec, request } from 'pactum';
\`\`\`

STRUCTURE:
- Use describe blocks for test organization
- Use spec() for fluent API testing
- Chain .get(), .post(), .put(), .delete() methods
- Use .expectStatus(), .expectJson(), .expectJsonLike()
- Use request.setBaseUrl() for base configuration

EXAMPLE:
\`\`\`javascript
describe('API Tests', () => {
  it('should fetch user', async () => {
    await spec()
      .get('/users/1')
      .expectStatus(200)
      .expectJsonLike({ id: 1 });
  });
});
\`\`\``,

      k6: `K6 LOAD TESTING FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
\`\`\`

STRUCTURE:
- Export options object for test configuration
- Export default function as main test
- Use http.get(), http.post(), etc. for requests
- Use check() for assertions
- Use sleep() between iterations

EXAMPLE:
\`\`\`javascript
export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
  },
};

export default function () {
  const res = http.get('https://api.example.com/endpoint');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);
}
\`\`\``,

      artillery: `ARTILLERY LOAD TESTING FRAMEWORK REQUIREMENTS:
OUTPUT FORMAT: Generate a YAML configuration file

STRUCTURE:
\`\`\`yaml
config:
  target: "https://api.example.com"
  phases:
    - duration: 60
      arrivalRate: 5
  defaults:
    headers:
      Content-Type: "application/json"

scenarios:
  - name: "API Test Flow"
    flow:
      - get:
          url: "/endpoint"
          capture:
            - json: "$.id"
              as: "userId"
      - post:
          url: "/endpoint"
          json:
            key: "value"
          expect:
            - statusCode: 201
\`\`\`

Include proper phases, scenarios, and assertions`,

      pytest: `PYTEST (PYTHON) FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`python
import pytest
import requests
from typing import Dict, Any
\`\`\`

STRUCTURE:
- Use test_ prefix for test functions
- Use @pytest.fixture for setup/teardown
- Use assert statements for assertions
- Use pytest.mark for test categorization
- Include proper type hints

EXAMPLE:
\`\`\`python
import pytest
import requests

BASE_URL = "https://api.example.com"

@pytest.fixture
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    yield session
    session.close()

def test_get_users(api_client):
    response = api_client.get(f"{BASE_URL}/users")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
\`\`\``,

      httpx: `HTTPX (PYTHON ASYNC) FRAMEWORK REQUIREMENTS:
REQUIRED IMPORTS:
\`\`\`python
import pytest
import httpx
import asyncio
from typing import AsyncGenerator
\`\`\`

STRUCTURE:
- Use async/await for all HTTP calls
- Use @pytest.fixture with async support
- Use httpx.AsyncClient for async requests
- Include proper error handling

EXAMPLE:
\`\`\`python
import pytest
import httpx

BASE_URL = "https://api.example.com"

@pytest.fixture
async def async_client() -> AsyncGenerator[httpx.AsyncClient, None]:
    async with httpx.AsyncClient(base_url=BASE_URL) as client:
        yield client

@pytest.mark.asyncio
async def test_get_users(async_client):
    response = await async_client.get("/users")
    assert response.status_code == 200
    data = response.json()
    assert "users" in data
\`\`\``,

      karate: `KARATE (JAVA) FRAMEWORK REQUIREMENTS:
FILE FORMAT: Generate .feature files with Karate syntax

STRUCTURE:
\`\`\`gherkin
Feature: API Tests

  Background:
    * url 'https://api.example.com'
    * header Content-Type = 'application/json'

  Scenario: Get users
    Given path '/users'
    When method get
    Then status 200
    And match response == '#array'
    And match each response contains { id: '#number', name: '#string' }

  Scenario: Create user
    Given path '/users'
    And request { name: 'John', email: 'john@example.com' }
    When method post
    Then status 201
    And match response.id == '#number'
\`\`\`

Include Background for common setup, use Karate match syntax`,

      postman: `POSTMAN COLLECTION REQUIREMENTS:
🚨 CRITICAL: You MUST generate a complete Postman Collection JSON, NOT test code!

MANDATORY OUTPUT FORMAT - Generate VALID JSON following this EXACT structure:
{
  "info": {
    "name": "Generated API Collection",
    "description": "Generated from XHRScribe recording",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Endpoint Name",
      "request": {
        "method": "GET|POST|PUT|DELETE",
        "header": [],
        "body": { "mode": "raw", "raw": "{\"key\": \"value\"}" },
        "url": { "raw": "{{baseUrl}}/endpoint", "host": ["{{baseUrl}}"], "path": ["endpoint"] }
      },
      "event": [
        {
          "listen": "test",
          "script": {
            "exec": [
              "pm.test('Status code is 200', function () {",
              "    pm.response.to.have.status(200);",
              "});",
              "pm.test('Response has required fields', function () {",
              "    const jsonData = pm.response.json();",
              "    pm.expect(jsonData).to.have.property('expectedField');",
              "});"
            ]
          }
        }
      ]
    }
  ],
  "variable": [
    { "key": "baseUrl", "value": "https://api.example.com" }
  ]
}

⚠️  DO NOT generate describe() or it() blocks - Only valid Postman Collection JSON!`,

        restassured: `REST ASSURED (JAVA) FRAMEWORK REQUIREMENTS:
🚨 CRITICAL: Generate Java test code using REST Assured library!

MANDATORY JAVA STRUCTURE:
- Use @Test annotations from TestNG or JUnit
- Import static io.restassured.RestAssured.*
- Import static org.hamcrest.Matchers.*
- Use given().when().then() pattern
- Include proper assertions with Hamcrest matchers
- Add JSON/XML response validation
- Use RequestSpecification for reusable configurations
- Include proper error handling and logging

EXAMPLE STRUCTURE:
import io.restassured.RestAssured;
import static io.restassured.RestAssured.*;
import static org.hamcrest.Matchers.*;
import org.testng.annotations.Test;

public class APITests {
    @Test
    public void testGetEndpoint() {
        given()
            .baseUri("https://api.example.com")
            .header("Authorization", "Bearer token")
        .when()
            .get("/endpoint")
        .then()
            .statusCode(200)
            .body("field", equalTo("expectedValue"));
    }
}

⚠️  OUTPUT MUST BE: Complete Java class with REST Assured tests`,
    };

    return instructions[framework] || instructions.jest;
  }

  private getTestTypeInstructions(options: GenerationOptions): string {
    const instructions: string[] = [];

    if (options.includeAuth) {
      instructions.push(`AUTHENTICATION TESTS:
- Test with valid credentials
- Test with invalid credentials
- Test token expiration
- Test permission levels`);
    }

    if (options.includeErrorScenarios) {
      instructions.push(`ERROR SCENARIO TESTS:
- Test 400 Bad Request scenarios
- Test 401 Unauthorized scenarios
- Test 404 Not Found scenarios
- Test 500 Internal Server Error handling
- Test timeout scenarios`);
    }

    if (options.includePerformanceTests) {
      instructions.push(`PERFORMANCE TESTS:
- Assert response times < 1000ms for standard requests
- Assert response times < 3000ms for complex operations
- Include load testing scenarios
- Test concurrent request handling`);
    }

    if (options.includeSecurityTests) {
      instructions.push(`SECURITY TESTS:
- Test for SQL injection vulnerabilities
- Test for XSS vulnerabilities
- Validate proper CORS headers
- Check for sensitive data exposure
- Test rate limiting`);
    }

    if (options.generateMockData) {
      instructions.push(`MOCK DATA GENERATION:
- Generate realistic test data
- Use faker or similar libraries
- Create edge case data
- Include boundary value testing`);
    }

    return instructions.join('\n\n');
  }

  private analyzeEndpoints(harData: HARData): {
    totalEndpoints: number;
    summary: string;
    endpointList: string;
  } {
    const endpoints = new Map<string, {method: string, path: string, url: string, count: number}>();
    
    harData.entries.forEach(entry => {
      const url = new URL(entry.request.url);
      const signature = `${entry.request.method}:${url.pathname}`;
      
      if (endpoints.has(signature)) {
        endpoints.get(signature)!.count++;
      } else {
        endpoints.set(signature, {
          method: entry.request.method,
          path: url.pathname,
          url: entry.request.url,
          count: 1
        });
      }
    });

    const endpointDetails = Array.from(endpoints.values());
    
    const summary = endpointDetails.map((ep, index) => 
      `${index + 1}. ${ep.method} ${ep.path} (${new URL(ep.url).hostname}) - ${ep.count} request(s)`
    ).join('\n');

    const endpointList = endpointDetails.map(ep => 
      `- ${ep.method} ${ep.path}`
    ).join('\n');

    return {
      totalEndpoints: endpoints.size,
      summary,
      endpointList
    };
  }

  getModelCapabilities(model: AIModel): {
    maxTokens: number;
    costPer1kTokens: number;
    quality: 'high' | 'medium' | 'low';
  } {
    const capabilities: Record<string, any> = {
      'gpt-4o': { maxTokens: 128000, costPer1kTokens: 0.01, quality: 'high' },
      'gpt-4o-mini': { maxTokens: 128000, costPer1kTokens: 0.0003, quality: 'medium' },
      'gpt-4-turbo': { maxTokens: 128000, costPer1kTokens: 0.01, quality: 'high' },
      'gpt-4': { maxTokens: 8192, costPer1kTokens: 0.03, quality: 'high' },
      'gpt-3.5-turbo': { maxTokens: 16384, costPer1kTokens: 0.0015, quality: 'medium' },
      'claude-3.5-sonnet': { maxTokens: 200000, costPer1kTokens: 0.003, quality: 'high' },
      'claude-3-haiku': { maxTokens: 200000, costPer1kTokens: 0.00025, quality: 'medium' },
      'claude-3-opus': { maxTokens: 200000, costPer1kTokens: 0.015, quality: 'high' },
      'gemini-1.5-pro': { maxTokens: 1000000, costPer1kTokens: 0.007, quality: 'high' },
      'gemini-1.5-flash': { maxTokens: 1000000, costPer1kTokens: 0.00035, quality: 'medium' },
      'gemini-pro': { maxTokens: 32000, costPer1kTokens: 0.001, quality: 'medium' },
      'llama-3.1': { maxTokens: 128000, costPer1kTokens: 0, quality: 'medium' },
      'codellama': { maxTokens: 16000, costPer1kTokens: 0, quality: 'low' },
    };

    return (
      capabilities[model] || {
        maxTokens: 4096,
        costPer1kTokens: 0.002,
        quality: 'medium',
      }
    );
  }
}