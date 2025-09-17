import { AuthFlow } from './AuthFlowAnalyzer';
import { TestFramework } from '@/types';

export class FrameworkSetupGenerator {
  private static instance: FrameworkSetupGenerator;

  static getInstance(): FrameworkSetupGenerator {
    if (!FrameworkSetupGenerator.instance) {
      FrameworkSetupGenerator.instance = new FrameworkSetupGenerator();
    }
    return FrameworkSetupGenerator.instance;
  }

  generateCompleteSetup(framework: TestFramework, authFlow: AuthFlow): string {
    const baseSetup = this.getFrameworkBaseSetup(framework);
    const authSetup = this.generateAuthenticationSetup(framework, authFlow);
    const utilities = this.generateUtilities(framework, authFlow);
    const cleanup = this.generateCleanup(framework, authFlow);

    return `${baseSetup}\n\n${authSetup}\n\n${utilities}\n\n${cleanup}`;
  }

  private getFrameworkBaseSetup(framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        return this.getPlaywrightBaseSetup();
      case 'cypress':
        return this.getCypressBaseSetup();
      case 'jest':
        return this.getJestBaseSetup();
      case 'mocha':
        return this.getMochaBaseSetup();
      case 'vitest':
        return this.getVitestBaseSetup();
      default:
        return this.getJestBaseSetup();
    }
  }

  private getPlaywrightBaseSetup(): string {
    return `import { test, expect, Page, Request, APIRequestContext } from '@playwright/test';
import { faker } from '@faker-js/faker';
import Ajv from 'ajv';

// Test configuration
test.describe.configure({ mode: 'serial' });
test.setTimeout(60000); // 60 second timeout for complex operations

// Global test state
interface AuthState {
  accessToken?: string;
  refreshToken?: string;
  sessionCookies?: string[];
  csrfToken?: string;
  userSession?: any;
  expiresAt?: number;
}

let authState: AuthState = {};
let apiContext: APIRequestContext;

// Environment validation
const requiredEnvVars = ['API_BASE_URL'];
const optionalEnvVars = ['TEST_USERNAME', 'TEST_PASSWORD', 'TEST_API_KEY'];

test.beforeAll(async ({ playwright }) => {
  // Validate required environment variables
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(\`Missing required environment variable: \${envVar}\`);
    }
  }

  // Create persistent API context
  apiContext = await playwright.request.newContext({
    baseURL: process.env.API_BASE_URL,
    timeout: 30000,
    ignoreHTTPSErrors: true
  });
});`;
  }

  private getCypressBaseSetup(): string {
    return `/// <reference types="cypress" />
import { faker } from '@faker-js/faker';

// Global configuration
Cypress.config('defaultCommandTimeout', 10000);
Cypress.config('requestTimeout', 30000);
Cypress.config('responseTimeout', 30000);

// Authentication state
let authState = {
  accessToken: null,
  refreshToken: null,
  sessionCookies: [],
  csrfToken: null,
  userSession: null
};

// Custom commands for authentication
Cypress.Commands.add('authenticateAPI', () => {
  // Will be implemented based on detected auth flow
});

Cypress.Commands.add('setAuthHeaders', (headers = {}) => {
  if (authState.accessToken) {
    headers['Authorization'] = \`Bearer \${authState.accessToken}\`;
  }
  if (authState.csrfToken) {
    headers['X-CSRF-Token'] = authState.csrfToken;
  }
  return headers;
});

// Environment validation
before(() => {
  const requiredEnvVars = ['CYPRESS_API_BASE_URL'];
  requiredEnvVars.forEach(envVar => {
    if (!Cypress.env(envVar)) {
      throw new Error(\`Missing required environment variable: \${envVar}\`);
    }
  });
});`;
  }

  private getJestBaseSetup(): string {
    return `import request from 'supertest';
import { faker } from '@faker-js/faker';
import Ajv from 'ajv';

// Global test configuration
jest.setTimeout(60000); // 60 second timeout

// Authentication state
interface AuthState {
  accessToken?: string;
  refreshToken?: string;
  sessionCookies?: string[];
  csrfToken?: string;
  userSession?: any;
}

let authState: AuthState = {};
let app: any; // Your Express app instance

// Environment validation
const requiredEnvVars = ['API_BASE_URL', 'NODE_ENV'];
const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(\`Missing required environment variables: \${missingEnvVars.join(', ')}\`);
}

// Test utilities
const apiRequest = request(process.env.API_BASE_URL || 'http://localhost:3000');`;
  }

  private getMochaBaseSetup(): string {
    return `import { expect } from 'chai';
import request from 'supertest';
import { faker } from '@faker-js/faker';

// Global configuration
this.timeout(60000); // 60 second timeout

// Authentication state
let authState = {
  accessToken: null,
  refreshToken: null,
  sessionCookies: [],
  csrfToken: null
};

// Base API instance
const api = request(process.env.API_BASE_URL || 'http://localhost:3000');`;
  }

  private getVitestBaseSetup(): string {
    return `import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { faker } from '@faker-js/faker';
import Ajv from 'ajv';

// Test configuration
const testTimeout = 60000; // 60 second timeout

// Authentication state
interface AuthState {
  accessToken?: string;
  refreshToken?: string;
  sessionCookies?: string[];
  csrfToken?: string;
  userSession?: any;
}

let authState: AuthState = {};

// Environment validation
beforeAll(() => {
  const requiredEnvVars = ['API_BASE_URL'];
  const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
  
  if (missingVars.length > 0) {
    throw new Error(\`Missing environment variables: \${missingVars.join(', ')}\`);
  }
});`;
  }

  private generateAuthenticationSetup(framework: TestFramework, authFlow: AuthFlow): string {
    const authMethod = this.getAuthenticationMethod(authFlow);
    
    switch (framework) {
      case 'playwright':
        return this.generatePlaywrightAuth(authFlow, authMethod);
      case 'cypress':
        return this.generateCypressAuth(authFlow, authMethod);
      case 'jest':
        return this.generateJestAuth(authFlow, authMethod);
      case 'mocha':
        return this.generateMochaAuth(authFlow, authMethod);
      case 'vitest':
        return this.generateVitestAuth(authFlow, authMethod);
      default:
        return this.generateJestAuth(authFlow, authMethod);
    }
  }

  private getAuthenticationMethod(authFlow: AuthFlow): string {
    switch (authFlow.authPattern) {
      case 'oauth2':
        return 'oauth2';
      case 'jwt':
        return 'jwt';
      case 'api_key':
        return 'api_key';
      case 'cookie_based':
        return 'session_cookies';
      case 'mixed':
        return 'mixed';
      default:
        return 'bearer_token';
    }
  }

  private generatePlaywrightAuth(authFlow: AuthFlow, method: string): string {
    const loginUrl = authFlow.loginEndpoint?.url || '/login';
    
    let authSetup = `
// Authentication setup
test.beforeAll(async ({ request }) => {
  console.log('🔐 Setting up authentication...');
  
  try {`;

    switch (method) {
      case 'oauth2':
        authSetup += this.generateOAuth2Setup('playwright', authFlow);
        break;
      case 'jwt':
        authSetup += this.generateJWTSetup('playwright', authFlow);
        break;
      case 'api_key':
        authSetup += this.generateAPIKeySetup('playwright', authFlow);
        break;
      case 'session_cookies':
        authSetup += this.generateSessionCookieSetup('playwright', authFlow);
        break;
      case 'mixed':
        authSetup += this.generateMixedAuthSetup('playwright', authFlow);
        break;
      default:
        authSetup += this.generateBearerTokenSetup('playwright', authFlow);
    }

    authSetup += `
    console.log('✅ Authentication setup completed');
  } catch (error) {
    console.error('❌ Authentication setup failed:', error);
    throw error;
  }
});`;

    return authSetup;
  }

  private generateCypressAuth(authFlow: AuthFlow, method: string): string {
    let authSetup = `
// Authentication implementation
Cypress.Commands.add('authenticateAPI', () => {
  return cy.then(() => {
    return new Cypress.Promise((resolve, reject) => {`;

    switch (method) {
      case 'oauth2':
        authSetup += this.generateOAuth2Setup('cypress', authFlow);
        break;
      case 'jwt':
        authSetup += this.generateJWTSetup('cypress', authFlow);
        break;
      case 'api_key':
        authSetup += this.generateAPIKeySetup('cypress', authFlow);
        break;
      case 'session_cookies':
        authSetup += this.generateSessionCookieSetup('cypress', authFlow);
        break;
      default:
        authSetup += this.generateBearerTokenSetup('cypress', authFlow);
    }

    authSetup += `
      resolve(authState);
    });
  });
});

// Setup authentication before all tests
before(() => {
  cy.authenticateAPI();
});`;

    return authSetup;
  }

  private generateJestAuth(authFlow: AuthFlow, method: string): string {
    let authSetup = `
// Authentication setup
beforeAll(async () => {
  console.log('🔐 Setting up authentication...');
  
  try {`;

    switch (method) {
      case 'oauth2':
        authSetup += this.generateOAuth2Setup('jest', authFlow);
        break;
      case 'jwt':
        authSetup += this.generateJWTSetup('jest', authFlow);
        break;
      case 'api_key':
        authSetup += this.generateAPIKeySetup('jest', authFlow);
        break;
      case 'session_cookies':
        authSetup += this.generateSessionCookieSetup('jest', authFlow);
        break;
      default:
        authSetup += this.generateBearerTokenSetup('jest', authFlow);
    }

    authSetup += `
    console.log('✅ Authentication setup completed');
  } catch (error) {
    console.error('❌ Authentication setup failed:', error);
    throw error;
  }
});`;

    return authSetup;
  }

  private generateMochaAuth(authFlow: AuthFlow, method: string): string {
    let authSetup = `
// Authentication setup
before(async function() {
  this.timeout(30000); // Extend timeout for auth setup
  console.log('🔐 Setting up authentication...');
  
  try {`;

    switch (method) {
      case 'oauth2':
        authSetup += this.generateOAuth2Setup('mocha', authFlow);
        break;
      case 'jwt':
        authSetup += this.generateJWTSetup('mocha', authFlow);
        break;
      default:
        authSetup += this.generateBearerTokenSetup('mocha', authFlow);
    }

    authSetup += `
    console.log('✅ Authentication setup completed');
  } catch (error) {
    console.error('❌ Authentication setup failed:', error);
    throw error;
  }
});`;

    return authSetup;
  }

  private generateVitestAuth(authFlow: AuthFlow, method: string): string {
    let authSetup = `
// Authentication setup
beforeAll(async () => {
  console.log('🔐 Setting up authentication...');
  
  try {`;

    switch (method) {
      case 'oauth2':
        authSetup += this.generateOAuth2Setup('vitest', authFlow);
        break;
      case 'jwt':
        authSetup += this.generateJWTSetup('vitest', authFlow);
        break;
      default:
        authSetup += this.generateBearerTokenSetup('vitest', authFlow);
    }

    authSetup += `
    console.log('✅ Authentication setup completed');
  } catch (error) {
    console.error('❌ Authentication setup failed:', error);
    throw error;
  }
}, { timeout: testTimeout });`;

    return authSetup;
  }

  private generateOAuth2Setup(framework: string, authFlow: AuthFlow): string {
    const oauth = authFlow.oauthFlow;
    if (!oauth) return this.generateBearerTokenSetup(framework, authFlow);

    return `
    // OAuth 2.0 Authentication Flow
    const clientId = process.env.OAUTH_CLIENT_ID || '${oauth.clientId || 'your-client-id'}';
    const clientSecret = process.env.OAUTH_CLIENT_SECRET || 'your-client-secret';
    const tokenUrl = '${oauth.tokenUrl || '/oauth/token'}';
    
    ${oauth.grantType === 'client_credentials' ? `
    // Client Credentials Grant
    const tokenResponse = await ${this.getRequestMethod(framework)}
      .post(tokenUrl)
      .send({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: '${oauth.scopes.join(' ')}'
      })
      .expect(200);
    ` : `
    // Authorization Code Grant (simplified for testing)
    const tokenResponse = await ${this.getRequestMethod(framework)}
      .post(tokenUrl)
      .send({
        grant_type: 'password',
        username: process.env.TEST_USERNAME,
        password: process.env.TEST_PASSWORD,
        client_id: clientId,
        client_secret: clientSecret,
        scope: '${oauth.scopes.join(' ')}'
      })
      .expect(200);
    `}
    
    authState.accessToken = tokenResponse.body.access_token;
    authState.refreshToken = tokenResponse.body.refresh_token;
    authState.expiresAt = Date.now() + (tokenResponse.body.expires_in * 1000);
    
    console.log('🎫 OAuth 2.0 tokens acquired');`;
  }

  private generateJWTSetup(framework: string, authFlow: AuthFlow): string {
    const loginUrl = authFlow.loginEndpoint?.url || '/login';
    
    return `
    // JWT Authentication
    const loginResponse = await ${this.getRequestMethod(framework)}
      .post('${loginUrl}')
      .send({
        username: process.env.TEST_USERNAME || 'test@example.com',
        password: process.env.TEST_PASSWORD || 'testpassword'
      })
      .expect(200);
    
    // Extract JWT token
    const jwtToken = loginResponse.body.token || 
                    loginResponse.body.access_token || 
                    loginResponse.body.jwt;
    
    if (!jwtToken) {
      throw new Error('JWT token not found in login response');
    }
    
    authState.accessToken = jwtToken;
    
    // Decode JWT to check expiration
    try {
      const payload = JSON.parse(atob(jwtToken.split('.')[1]));
      authState.expiresAt = payload.exp * 1000;
      authState.userSession = payload;
      console.log('🎫 JWT token acquired, expires at:', new Date(authState.expiresAt));
    } catch (error) {
      console.warn('Could not decode JWT payload:', error);
    }`;
  }

  private generateAPIKeySetup(framework: string, authFlow: AuthFlow): string {
    const apiKey = authFlow.authTokens.find(t => t.type === 'api_key');
    const headerName = apiKey?.field || 'X-API-Key';

    return `
    // API Key Authentication
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error('API_KEY environment variable is required');
    }
    
    authState.accessToken = apiKey;
    console.log('🔑 API Key configured for header: ${headerName}');`;
  }

  private generateSessionCookieSetup(framework: string, authFlow: AuthFlow): string {
    const loginUrl = authFlow.loginEndpoint?.url || '/login';

    return `
    // Session Cookie Authentication
    const loginResponse = await ${this.getRequestMethod(framework)}
      .post('${loginUrl}')
      .send({
        username: process.env.TEST_USERNAME || 'test@example.com',
        password: process.env.TEST_PASSWORD || 'testpassword'
      })
      .expect(200);
    
    // Extract session cookies
    const cookies = loginResponse.headers['set-cookie'];
    if (cookies) {
      authState.sessionCookies = cookies.map(cookie => cookie.split(';')[0]);
      console.log('🍪 Session cookies acquired:', authState.sessionCookies.length);
    }`;
  }

  private generateMixedAuthSetup(framework: string, authFlow: AuthFlow): string {
    return `
    // Mixed Authentication (Tokens + Cookies)
    ${this.generateBearerTokenSetup(framework, authFlow)}
    ${this.generateSessionCookieSetup(framework, authFlow)}`;
  }

  private generateBearerTokenSetup(framework: string, authFlow: AuthFlow): string {
    const loginUrl = authFlow.loginEndpoint?.url || '/login';

    return `
    // Bearer Token Authentication
    const loginResponse = await ${this.getRequestMethod(framework)}
      .post('${loginUrl}')
      .send({
        username: process.env.TEST_USERNAME || 'test@example.com',
        password: process.env.TEST_PASSWORD || 'testpassword'
      })
      .expect(200);
    
    // Extract authentication token
    const authToken = loginResponse.body.token || 
                     loginResponse.body.access_token || 
                     loginResponse.body.authToken ||
                     loginResponse.headers['x-auth-token'];
    
    if (!authToken) {
      throw new Error('Authentication token not found in login response');
    }
    
    authState.accessToken = authToken;
    console.log('🎫 Bearer token acquired');`;
  }

  private getRequestMethod(framework: string): string {
    switch (framework) {
      case 'playwright':
        return 'request';
      case 'cypress':
        return 'cy.request';
      default:
        return 'apiRequest';
    }
  }

  private generateUtilities(framework: TestFramework, authFlow: AuthFlow): string {
    switch (framework) {
      case 'playwright':
        return this.generatePlaywrightUtilities(authFlow);
      case 'cypress':
        return this.generateCypressUtilities(authFlow);
      default:
        return this.generateJestUtilities(authFlow);
    }
  }

  private generatePlaywrightUtilities(authFlow: AuthFlow): string {
    return `
// Utility functions
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (authState.accessToken) {
    if (authState.accessToken.startsWith('Bearer ')) {
      headers['Authorization'] = authState.accessToken;
    } else {
      headers['Authorization'] = \`Bearer \${authState.accessToken}\`;
    }
  }
  
  if (authState.csrfToken) {
    headers['X-CSRF-Token'] = authState.csrfToken;
  }
  
  return headers;
}

async function makeAuthenticatedRequest(method: string, url: string, data?: any) {
  const options: any = {
    headers: getAuthHeaders()
  };
  
  if (data) {
    options.data = data;
  }
  
  return await apiContext[method.toLowerCase()](url, options);
}

function validateSchema(data: any, schema: object): boolean {
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const isValid = validate(data);
  
  if (!isValid) {
    console.error('Schema validation errors:', validate.errors);
  }
  
  return isValid;
}

function generateTestData(template: any): any {
  // Replace template values with realistic fake data
  return JSON.parse(JSON.stringify(template).replace(/"FAKE_(\w+)"/g, (match, type) => {
    switch (type.toLowerCase()) {
      case 'email': return \`"\${faker.internet.email()}"\`;
      case 'name': return \`"\${faker.person.fullName()}"\`;
      case 'phone': return \`"\${faker.phone.number()}"\`;
      case 'date': return \`"\${faker.date.recent().toISOString()}"\`;
      case 'uuid': return \`"\${faker.string.uuid()}"\`;
      case 'number': return faker.number.int({ min: 1, max: 1000 });
      default: return match;
    }
  }));
}`;
  }

  private generateCypressUtilities(authFlow: AuthFlow): string {
    return `
// Utility commands
Cypress.Commands.add('makeAuthenticatedRequest', (method, url, body = null) => {
  const headers = {};
  
  if (authState.accessToken) {
    headers['Authorization'] = \`Bearer \${authState.accessToken}\`;
  }
  
  if (authState.csrfToken) {
    headers['X-CSRF-Token'] = authState.csrfToken;
  }
  
  return cy.request({
    method,
    url: \`\${Cypress.env('API_BASE_URL')}\${url}\`,
    headers,
    body,
    failOnStatusCode: false
  });
});

Cypress.Commands.add('validateSchema', (data, schema) => {
  // Schema validation logic
  return cy.then(() => {
    const ajv = require('ajv');
    const validate = ajv.compile(schema);
    const isValid = validate(data);
    
    if (!isValid) {
      cy.log('Schema validation errors:', validate.errors);
    }
    
    expect(isValid).to.be.true;
  });
});`;
  }

  private generateJestUtilities(authFlow: AuthFlow): string {
    return `
// Utility functions
function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  
  if (authState.accessToken) {
    headers['Authorization'] = \`Bearer \${authState.accessToken}\`;
  }
  
  if (authState.csrfToken) {
    headers['X-CSRF-Token'] = authState.csrfToken;
  }
  
  return headers;
}

function validateSchema(data: any, schema: object): boolean {
  const ajv = new Ajv();
  const validate = ajv.compile(schema);
  const isValid = validate(data);
  
  if (!isValid) {
    console.error('Schema validation errors:', validate.errors);
  }
  
  return isValid;
}

function generateTestData(template: any): any {
  return JSON.parse(JSON.stringify(template).replace(/"FAKE_(\w+)"/g, (match, type) => {
    switch (type.toLowerCase()) {
      case 'email': return \`"\${faker.internet.email()}"\`;
      case 'name': return \`"\${faker.person.fullName()}"\`;
      case 'phone': return \`"\${faker.phone.number()}"\`;
      case 'date': return \`"\${faker.date.recent().toISOString()}"\`;
      case 'uuid': return \`"\${faker.string.uuid()}"\`;
      case 'number': return faker.number.int({ min: 1, max: 1000 });
      default: return match;
    }
  }));
}`;
  }

  private generateCleanup(framework: TestFramework, authFlow: AuthFlow): string {
    switch (framework) {
      case 'playwright':
        return `
// Cleanup after all tests
test.afterAll(async () => {
  console.log('🧹 Cleaning up authentication state...');
  
  if (authState.accessToken && authFlow.sessionManagement !== 'stateless') {
    try {
      // Attempt to logout/revoke tokens
      await apiContext.post('/logout', {
        headers: getAuthHeaders()
      });
      console.log('✅ Successfully logged out');
    } catch (error) {
      console.warn('⚠️ Logout failed (this may be normal):', error.message);
    }
  }
  
  if (apiContext) {
    await apiContext.dispose();
  }
  
  // Clear auth state
  authState = {};
});`;

      case 'cypress':
        return `
// Cleanup after all tests
after(() => {
  if (authState.accessToken) {
    cy.request({
      method: 'POST',
      url: \`\${Cypress.env('API_BASE_URL')}/logout\`,
      headers: { 'Authorization': \`Bearer \${authState.accessToken}\` },
      failOnStatusCode: false
    });
  }
});`;

      default:
        return `
// Cleanup after all tests
afterAll(async () => {
  if (authState.accessToken) {
    try {
      await apiRequest
        .post('/logout')
        .set('Authorization', \`Bearer \${authState.accessToken}\`)
        .send();
      console.log('✅ Successfully logged out');
    } catch (error) {
      console.warn('⚠️ Logout failed (this may be normal):', error.message);
    }
  }
  
  authState = {};
});`;
    }
  }
}
