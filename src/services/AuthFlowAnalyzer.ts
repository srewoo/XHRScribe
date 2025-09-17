import { NetworkRequest } from '@/types';

export interface AuthToken {
  type: 'bearer' | 'api_key' | 'custom';
  value: string;
  source: 'header' | 'body' | 'cookie';
  field: string;
  extractionPath?: string; // JSON path for extraction
}

export interface AuthFlow {
  loginEndpoint?: NetworkRequest;
  protectedEndpoints: NetworkRequest[];
  authTokens: AuthToken[];
  sessionCookies: string[];
  authPattern: 'token_based' | 'cookie_based' | 'api_key' | 'mixed' | 'oauth2' | 'jwt' | 'saml';
  // ENHANCED: Advanced authentication flow details
  oauthFlow?: {
    authorizationUrl?: string;
    tokenUrl?: string;
    scopes: string[];
    pkceEnabled: boolean;
    clientId?: string;
    grantType: 'authorization_code' | 'client_credentials' | 'password' | 'refresh_token';
  };
  jwtClaims?: Record<string, any>;
  refreshToken?: {
    endpoint: string;
    mechanism: 'rotation' | 'reuse';
    tokenField: string;
  };
  mfaRequired?: boolean;
  sessionManagement: 'stateless' | 'stateful' | 'hybrid';
  csrfProtection?: {
    tokenName: string;
    headerName: string;
    cookieName?: string;
  };
}

export class AuthFlowAnalyzer {
  private static instance: AuthFlowAnalyzer;

  static getInstance(): AuthFlowAnalyzer {
    if (!AuthFlowAnalyzer.instance) {
      AuthFlowAnalyzer.instance = new AuthFlowAnalyzer();
    }
    return AuthFlowAnalyzer.instance;
  }

  analyzeAuthFlow(requests: NetworkRequest[]): AuthFlow {
    const loginEndpoint = this.detectLoginEndpoint(requests);
    const protectedEndpoints = this.detectProtectedEndpoints(requests);
    const authTokens = this.extractAuthTokens(requests, loginEndpoint);
    const sessionCookies = this.extractSessionCookies(requests);
    
    // ENHANCED: Advanced authentication pattern detection
    const oauthFlow = this.detectOAuthFlow(requests);
    const jwtClaims = this.extractJWTClaims(authTokens);
    const refreshToken = this.detectRefreshTokenFlow(requests);
    const mfaRequired = this.detectMFARequirement(requests);
    const csrfProtection = this.detectCSRFProtection(requests);
    
    const authPattern = this.determineAdvancedAuthPattern(
      authTokens, 
      sessionCookies, 
      oauthFlow, 
      jwtClaims
    );
    
    const sessionManagement = this.determineSessionManagement(
      authTokens, 
      sessionCookies, 
      refreshToken
    );

    return {
      loginEndpoint,
      protectedEndpoints,
      authTokens,
      sessionCookies,
      authPattern,
      oauthFlow,
      jwtClaims,
      refreshToken,
      mfaRequired,
      sessionManagement,
      csrfProtection
    };
  }

  private detectLoginEndpoint(requests: NetworkRequest[]): NetworkRequest | undefined {
    // Look for common login patterns
    const loginPatterns = [
      /\/login$/i,
      /\/auth$/i,
      /\/authenticate$/i,
      /\/signin$/i,
      /\/oauth\/token$/i,
      /\/api\/auth$/i,
      /\/token$/i,
      /\/session$/i
    ];

    return requests.find(request => {
      // Check URL patterns
      const matchesUrl = loginPatterns.some(pattern => pattern.test(request.url));
      
      // Check for POST method (most login endpoints are POST)
      const isPost = request.method === 'POST';
      
      // Check for login-related request body
      const hasLoginPayload = this.hasLoginPayload(request);
      
      // Check for auth-related response (token, session, etc.)
      const hasAuthResponse = this.hasAuthResponse(request);

      return matchesUrl && isPost && (hasLoginPayload || hasAuthResponse);
    });
  }

  private hasLoginPayload(request: NetworkRequest): boolean {
    if (!request.requestBody) return false;

    const bodyStr = typeof request.requestBody === 'string' 
      ? request.requestBody 
      : JSON.stringify(request.requestBody);

    const loginFields = [
      'username', 'email', 'password', 'credentials',
      'grant_type', 'client_id', 'client_secret'
    ];

    return loginFields.some(field => bodyStr.toLowerCase().includes(field));
  }

  private hasAuthResponse(request: NetworkRequest): boolean {
    if (!request.responseBody) return false;

    const responseStr = typeof request.responseBody === 'string'
      ? request.responseBody
      : JSON.stringify(request.responseBody);

    const authFields = [
      'token', 'access_token', 'jwt', 'bearer',
      'session_id', 'auth_token', 'api_key',
      'refresh_token', 'id_token'
    ];

    return authFields.some(field => responseStr.toLowerCase().includes(field));
  }

  private detectProtectedEndpoints(requests: NetworkRequest[]): NetworkRequest[] {
    return requests.filter(request => {
      // Check for Authorization header
      const hasAuthHeader = this.hasAuthorizationHeader(request);
      
      // Check for protected endpoint patterns
      const isProtectedUrl = this.isProtectedUrl(request.url);
      
      // Check for 401/403 responses (might indicate protected endpoint)
      const hasAuthStatus = request.status === 401 || request.status === 403;

      return hasAuthHeader || isProtectedUrl || hasAuthStatus;
    });
  }

  private hasAuthorizationHeader(request: NetworkRequest): boolean {
    if (!request.requestHeaders) return false;

    const authHeaders = ['authorization', 'x-api-key', 'x-auth-token'];
    return authHeaders.some(header => 
      Object.keys(request.requestHeaders!).some(key => 
        key.toLowerCase() === header
      )
    );
  }

  private isProtectedUrl(url: string): boolean {
    const protectedPatterns = [
      /\/api\/.*\/user/i,
      /\/api\/.*\/profile/i,
      /\/api\/.*\/admin/i,
      /\/api\/.*\/dashboard/i,
      /\/api\/.*\/private/i,
      /\/api\/.*\/secure/i,
      /\/api\/.*\/protected/i,
      /\/me$/i,
      /\/account/i
    ];

    return protectedPatterns.some(pattern => pattern.test(url));
  }

  private extractAuthTokens(requests: NetworkRequest[], loginEndpoint?: NetworkRequest): AuthToken[] {
    const tokens: AuthToken[] = [];

    // Extract tokens from login response
    if (loginEndpoint && loginEndpoint.responseBody) {
      const responseTokens = this.extractTokensFromResponse(loginEndpoint);
      tokens.push(...responseTokens);
    }

    // Extract tokens from request headers in other requests
    requests.forEach(request => {
      const headerTokens = this.extractTokensFromHeaders(request);
      tokens.push(...headerTokens);
    });

    // Remove duplicates
    return this.deduplicateTokens(tokens);
  }

  private extractTokensFromResponse(request: NetworkRequest): AuthToken[] {
    const tokens: AuthToken[] = [];
    
    if (!request.responseBody) return tokens;

    try {
      const response = typeof request.responseBody === 'string'
        ? JSON.parse(request.responseBody)
        : request.responseBody;

      // Common token field patterns
      const tokenFields = [
        { field: 'access_token', type: 'bearer' as const },
        { field: 'token', type: 'bearer' as const },
        { field: 'jwt', type: 'bearer' as const },
        { field: 'bearer_token', type: 'bearer' as const },
        { field: 'auth_token', type: 'bearer' as const },
        { field: 'api_key', type: 'api_key' as const },
        { field: 'apikey', type: 'api_key' as const },
        { field: 'key', type: 'api_key' as const }
      ];

      for (const { field, type } of tokenFields) {
        const value = this.getNestedValue(response, field);
        if (value && typeof value === 'string') {
          tokens.push({
            type,
            value,
            source: 'body',
            field,
            extractionPath: this.findJsonPath(response, field)
          });
        }
      }
    } catch (error) {
      console.warn('Failed to parse response body for token extraction:', error);
    }

    return tokens;
  }

  private extractTokensFromHeaders(request: NetworkRequest): AuthToken[] {
    const tokens: AuthToken[] = [];
    
    if (!request.requestHeaders) return tokens;

    Object.entries(request.requestHeaders).forEach(([name, value]) => {
      const headerName = name.toLowerCase();
      const headerValue = String(value);

      if (headerName === 'authorization') {
        if (headerValue.startsWith('Bearer ')) {
          tokens.push({
            type: 'bearer',
            value: headerValue.substring(7),
            source: 'header',
            field: 'Authorization'
          });
        } else if (headerValue.startsWith('ApiKey ')) {
          tokens.push({
            type: 'api_key',
            value: headerValue.substring(7),
            source: 'header',
            field: 'Authorization'
          });
        }
      } else if (headerName.includes('api') && headerName.includes('key')) {
        tokens.push({
          type: 'api_key',
          value: headerValue,
          source: 'header',
          field: name
        });
      } else if (headerName.includes('token')) {
        tokens.push({
          type: 'custom',
          value: headerValue,
          source: 'header',
          field: name
        });
      }
    });

    return tokens;
  }

  private extractSessionCookies(requests: NetworkRequest[]): string[] {
    const cookies = new Set<string>();

    requests.forEach(request => {
      // Check response headers for Set-Cookie
      if (request.responseHeaders) {
        Object.entries(request.responseHeaders).forEach(([name, value]) => {
          if (name.toLowerCase() === 'set-cookie') {
            const cookieValue = String(value);
            const cookieName = cookieValue.split('=')[0];
            
            // Common session cookie patterns
            const sessionPatterns = [
              /session/i, /sess/i, /auth/i, /token/i,
              /jwt/i, /connect\.sid/i, /jsessionid/i
            ];

            if (sessionPatterns.some(pattern => pattern.test(cookieName))) {
              cookies.add(cookieName);
            }
          }
        });
      }
    });

    return Array.from(cookies);
  }

  // ENHANCED: Advanced authentication pattern determination
  private determineAdvancedAuthPattern(
    tokens: AuthToken[], 
    cookies: string[], 
    oauthFlow?: AuthFlow['oauthFlow'],
    jwtClaims?: Record<string, any>
  ): AuthFlow['authPattern'] {
    const hasTokens = tokens.length > 0;
    const hasCookies = cookies.length > 0;
    const hasApiKeys = tokens.some(t => t.type === 'api_key');
    const hasJWT = jwtClaims && Object.keys(jwtClaims).length > 0;
    const hasOAuth = oauthFlow && (oauthFlow.authorizationUrl || oauthFlow.tokenUrl);

    // Priority order: OAuth2 > JWT > API Key > Mixed > Cookie > Token
    if (hasOAuth) return 'oauth2';
    if (hasJWT) return 'jwt';
    if (hasApiKeys && !hasCookies) return 'api_key';
    if (hasTokens && hasCookies) return 'mixed';
    if (hasCookies && !hasTokens) return 'cookie_based';
    if (hasTokens && !hasCookies) return 'token_based';
    
    return 'token_based'; // Default assumption
  }

  // NEW: OAuth 2.0 flow detection
  private detectOAuthFlow(requests: NetworkRequest[]): AuthFlow['oauthFlow'] | undefined {
    const authRequests = requests.filter(r => 
      r.url.includes('/oauth/') || 
      r.url.includes('/auth/') || 
      r.url.includes('oauth2') ||
      r.url.includes('authorization') ||
      r.url.includes('token')
    );

    if (authRequests.length === 0) return undefined;

    // Detect authorization endpoint
    const authEndpoint = authRequests.find(r => 
      (r.url.includes('authorize') || r.url.includes('consent')) && r.method === 'GET'
    );

    // Detect token endpoint
    const tokenEndpoint = authRequests.find(r =>
      r.url.includes('token') && r.method === 'POST'
    );

    if (authEndpoint || tokenEndpoint) {
      const scopes = this.extractScopes(authRequests);
      const pkceEnabled = this.detectPKCE(authRequests);
      const clientId = this.extractClientId(authRequests);
      const grantType = this.detectGrantType(authRequests);

      return {
        authorizationUrl: authEndpoint?.url,
        tokenUrl: tokenEndpoint?.url,
        scopes,
        pkceEnabled,
        clientId,
        grantType
      };
    }

    return undefined;
  }

  private extractScopes(requests: NetworkRequest[]): string[] {
    const scopes: string[] = [];
    
    requests.forEach(request => {
      const url = request.url;
      const body = request.requestBody;
      
      // Extract scopes from URL parameters
      const scopeMatch = url.match(/[?&]scope=([^&]+)/);
      if (scopeMatch) {
        scopes.push(...scopeMatch[1].split(/[+%20]/));
      }
      
      // Extract scopes from request body
      if (body && typeof body === 'string') {
        const bodyScopeMatch = body.match(/scope[=:]([^&\n\r]+)/);
        if (bodyScopeMatch) {
          scopes.push(...bodyScopeMatch[1].split(/[+%20 ]/));
        }
      }
    });
    
    return [...new Set(scopes)].filter(Boolean);
  }

  private detectPKCE(requests: NetworkRequest[]): boolean {
    return requests.some(request => 
      request.url.includes('code_challenge') || 
      request.url.includes('code_verifier') ||
      (request.requestBody && 
       typeof request.requestBody === 'string' && 
       (request.requestBody.includes('code_challenge') || 
        request.requestBody.includes('code_verifier')))
    );
  }

  private extractClientId(requests: NetworkRequest[]): string | undefined {
    for (const request of requests) {
      const url = request.url;
      const body = request.requestBody;
      
      // Extract from URL
      const urlMatch = url.match(/[?&]client_id=([^&]+)/);
      if (urlMatch) return urlMatch[1];
      
      // Extract from body
      if (body && typeof body === 'string') {
        const bodyMatch = body.match(/client_id[=:]([^&\n\r]+)/);
        if (bodyMatch) return bodyMatch[1];
      }
    }
    return undefined;
  }

  private detectGrantType(requests: NetworkRequest[]): AuthFlow['oauthFlow']['grantType'] {
    for (const request of requests) {
      const body = request.requestBody;
      if (body && typeof body === 'string') {
        if (body.includes('grant_type=authorization_code')) return 'authorization_code';
        if (body.includes('grant_type=client_credentials')) return 'client_credentials';
        if (body.includes('grant_type=password')) return 'password';
        if (body.includes('grant_type=refresh_token')) return 'refresh_token';
      }
    }
    return 'authorization_code'; // Default
  }

  // NEW: JWT claims extraction
  private extractJWTClaims(tokens: AuthToken[]): Record<string, any> | undefined {
    const jwtTokens = tokens.filter(token => 
      token.value.includes('.') && token.value.split('.').length === 3
    );

    if (jwtTokens.length === 0) return undefined;

    try {
      // Decode the first JWT found
      const jwt = jwtTokens[0].value;
      const parts = jwt.split('.');
      
      // Decode the payload (second part)
      const payload = JSON.parse(atob(parts[1]));
      
      return payload;
    } catch (error) {
      console.warn('Failed to decode JWT:', error);
      return undefined;
    }
  }

  // NEW: Refresh token flow detection
  private detectRefreshTokenFlow(requests: NetworkRequest[]): AuthFlow['refreshToken'] | undefined {
    const refreshRequests = requests.filter(r => 
      r.url.includes('refresh') || 
      r.url.includes('renew') ||
      (r.requestBody && 
       typeof r.requestBody === 'string' && 
       r.requestBody.includes('refresh_token'))
    );

    if (refreshRequests.length === 0) return undefined;

    const refreshEndpoint = refreshRequests[0];
    
    // Determine mechanism based on response
    const mechanism = this.determineRefreshMechanism(refreshRequests);
    const tokenField = this.extractRefreshTokenField(refreshRequests);

    return {
      endpoint: refreshEndpoint.url,
      mechanism,
      tokenField
    };
  }

  private determineRefreshMechanism(requests: NetworkRequest[]): 'rotation' | 'reuse' {
    // If multiple refresh requests with different tokens, it's rotation
    const refreshTokens = new Set();
    
    requests.forEach(request => {
      if (request.requestBody && typeof request.requestBody === 'string') {
        const tokenMatch = request.requestBody.match(/refresh_token[=:]([^&\n\r]+)/);
        if (tokenMatch) {
          refreshTokens.add(tokenMatch[1]);
        }
      }
    });
    
    return refreshTokens.size > 1 ? 'rotation' : 'reuse';
  }

  private extractRefreshTokenField(requests: NetworkRequest[]): string {
    // Look for the field name used for refresh tokens
    for (const request of requests) {
      if (request.requestBody && typeof request.requestBody === 'string') {
        if (request.requestBody.includes('refresh_token')) return 'refresh_token';
        if (request.requestBody.includes('refreshToken')) return 'refreshToken';
        if (request.requestBody.includes('refresh')) return 'refresh';
      }
    }
    return 'refresh_token'; // Default
  }

  // NEW: MFA detection
  private detectMFARequirement(requests: NetworkRequest[]): boolean {
    return requests.some(request => 
      request.url.includes('mfa') ||
      request.url.includes('2fa') ||
      request.url.includes('totp') ||
      request.url.includes('otp') ||
      request.url.includes('verify') ||
      (request.requestBody && 
       typeof request.requestBody === 'string' && 
       (request.requestBody.includes('verification_code') ||
        request.requestBody.includes('mfa_token') ||
        request.requestBody.includes('totp_code')))
    );
  }

  // NEW: CSRF protection detection
  private detectCSRFProtection(requests: NetworkRequest[]): AuthFlow['csrfProtection'] | undefined {
    for (const request of requests) {
      const headers = request.requestHeaders || {};
      
      // Check for CSRF headers
      for (const [headerName, headerValue] of Object.entries(headers)) {
        if (headerName.toLowerCase().includes('csrf') || 
            headerName.toLowerCase().includes('xsrf')) {
          
          // Look for corresponding cookie
          const cookieName = this.findCSRFCookie(requests, headerValue);
          
          return {
            tokenName: 'csrf_token',
            headerName,
            cookieName
          };
        }
      }
    }
    
    return undefined;
  }

  private findCSRFCookie(requests: NetworkRequest[], tokenValue: string): string | undefined {
    for (const request of requests) {
      const cookies = request.requestHeaders?.cookie || '';
      if (cookies.includes(tokenValue)) {
        // Extract cookie name
        const cookieMatch = cookies.match(/([^=]+)=${tokenValue}/);
        return cookieMatch ? cookieMatch[1] : undefined;
      }
    }
    return undefined;
  }

  // NEW: Session management determination
  private determineSessionManagement(
    tokens: AuthToken[], 
    cookies: string[], 
    refreshToken?: AuthFlow['refreshToken']
  ): AuthFlow['sessionManagement'] {
    const hasTokens = tokens.length > 0;
    const hasCookies = cookies.length > 0;
    const hasRefresh = !!refreshToken;

    if (hasTokens && !hasCookies && !hasRefresh) return 'stateless';
    if (!hasTokens && hasCookies) return 'stateful';
    if (hasTokens && (hasCookies || hasRefresh)) return 'hybrid';
    
    return 'stateless'; // Default
  }

  private getNestedValue(obj: any, path: string): any {
    // Simple dot notation support
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return null;
      }
    }
    
    return current;
  }

  private findJsonPath(obj: any, targetField: string, currentPath = ''): string | undefined {
    if (typeof obj !== 'object' || obj === null) return undefined;

    for (const [key, value] of Object.entries(obj)) {
      const newPath = currentPath ? `${currentPath}.${key}` : key;
      
      if (key === targetField) {
        return newPath;
      }
      
      if (typeof value === 'object' && value !== null) {
        const found = this.findJsonPath(value, targetField, newPath);
        if (found) return found;
      }
    }

    return undefined;
  }

  private deduplicateTokens(tokens: AuthToken[]): AuthToken[] {
    const seen = new Set<string>();
    return tokens.filter(token => {
      const key = `${token.type}-${token.source}-${token.field}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // Helper method to generate test setup code
  generateAuthSetup(authFlow: AuthFlow, framework: string): string {
    if (!authFlow.loginEndpoint) return '';

    const { loginEndpoint, authTokens, sessionCookies, authPattern } = authFlow;

    switch (framework) {
      case 'jest':
      case 'supertest':
        return this.generateSupertestAuthSetup(authFlow);
      case 'playwright':
        return this.generatePlaywrightAuthSetup(authFlow);
      case 'cypress':
        return this.generateCypressAuthSetup(authFlow);
      default:
        return this.generateGenericAuthSetup(authFlow);
    }
  }

  private generateSupertestAuthSetup(authFlow: AuthFlow): string {
    const { loginEndpoint, authTokens, authPattern } = authFlow;
    
    if (!loginEndpoint) return '';

    const primaryToken = authTokens.find(t => t.type === 'bearer') || authTokens[0];
    
    if (authPattern === 'cookie_based') {
      return `
let authenticatedAgent;

beforeAll(async () => {
  // Create agent for cookie-based authentication
  authenticatedAgent = request.agent(app);
  
  // Perform login to establish session
  await authenticatedAgent
    .post('${new URL(loginEndpoint.url).pathname}')
    .send(${JSON.stringify(this.extractLoginCredentials(loginEndpoint), null, 6)})
    .expect(200);
});`;
    }

    if (primaryToken) {
      return `
let authToken;

beforeAll(async () => {
  // Perform login to get authentication token
  const loginResponse = await request(app)
    .post('${new URL(loginEndpoint.url).pathname}')
    .send(${JSON.stringify(this.extractLoginCredentials(loginEndpoint), null, 6)})
    .expect(200);
  
  // Extract token from response
  authToken = loginResponse.body${primaryToken.extractionPath ? `.${primaryToken.extractionPath}` : `.${primaryToken.field}`};
  
  if (!authToken) {
    throw new Error('Failed to extract authentication token from login response');
  }
});`;
    }

    return '';
  }

  private generatePlaywrightAuthSetup(authFlow: AuthFlow): string {
    const { loginEndpoint, authTokens } = authFlow;
    
    if (!loginEndpoint) return '';

    const primaryToken = authTokens.find(t => t.type === 'bearer') || authTokens[0];
    
    if (!primaryToken) return '';

    return `
let authToken;

test.beforeAll(async ({ request }) => {
  // Perform login to get authentication token
  const loginResponse = await request.post('${loginEndpoint.url}', {
    data: ${JSON.stringify(this.extractLoginCredentials(loginEndpoint), null, 6)}
  });
  
  expect(loginResponse.ok()).toBeTruthy();
  const responseBody = await loginResponse.json();
  
  // Extract token from response
  authToken = responseBody${primaryToken.extractionPath ? `.${primaryToken.extractionPath}` : `.${primaryToken.field}`};
  
  if (!authToken) {
    throw new Error('Failed to extract authentication token from login response');
  }
});`;
  }

  private generateCypressAuthSetup(authFlow: AuthFlow): string {
    const { loginEndpoint, authTokens } = authFlow;
    
    if (!loginEndpoint) return '';

    const primaryToken = authTokens.find(t => t.type === 'bearer') || authTokens[0];
    
    if (!primaryToken) return '';

    return `
let authToken;

before(() => {
  // Perform login to get authentication token
  cy.request({
    method: 'POST',
    url: '${loginEndpoint.url}',
    body: ${JSON.stringify(this.extractLoginCredentials(loginEndpoint), null, 6)}
  }).then((response) => {
    expect(response.status).to.eq(200);
    
    // Extract token from response
    authToken = response.body${primaryToken.extractionPath ? `.${primaryToken.extractionPath}` : `.${primaryToken.field}`};
    
    if (!authToken) {
      throw new Error('Failed to extract authentication token from login response');
    }
  });
});`;
  }

  private generateGenericAuthSetup(authFlow: AuthFlow): string {
    return `
// Authentication setup required
// Login endpoint: ${authFlow.loginEndpoint?.url}
// Auth pattern: ${authFlow.authPattern}
// Tokens: ${authFlow.authTokens.map(t => `${t.type} (${t.source})`).join(', ')}`;
  }

  private extractLoginCredentials(loginEndpoint: NetworkRequest): any {
    if (!loginEndpoint.requestBody) return {};

    try {
      const body = typeof loginEndpoint.requestBody === 'string'
        ? JSON.parse(loginEndpoint.requestBody)
        : loginEndpoint.requestBody;

      // Replace actual values with environment variables or placeholders
      const credentials: any = {};
      
      Object.entries(body).forEach(([key, value]) => {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes('username') || lowerKey.includes('email')) {
          credentials[key] = '${process.env.TEST_USERNAME || "test@example.com"}';
        } else if (lowerKey.includes('password')) {
          credentials[key] = '${process.env.TEST_PASSWORD || "testpassword"}';
        } else {
          credentials[key] = value;
        }
      });

      return credentials;
    } catch (error) {
      return {};
    }
  }
}
