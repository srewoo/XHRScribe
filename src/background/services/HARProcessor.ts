import { NetworkRequest, HARData, HAREntry, RecordingSession } from '@/types';

export class HARProcessor {
  private sessions: Map<string, Map<string, NetworkRequest>> = new Map();
  private harVersion = '1.2';

  startSession(sessionId: string): void {
    this.sessions.set(sessionId, new Map());
  }

  endSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  addRequest(sessionId: string, request: NetworkRequest): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.set(request.id, request);
    }
  }

  updateResponse(sessionId: string, requestId: string, response: any): void {
    const session = this.sessions.get(sessionId);
    const request = session?.get(requestId);
    if (request) {
      request.status = response.status;
      request.responseHeaders = response.headers;
    }
  }

  updateResponseBody(sessionId: string, requestId: string, body: string): void {
    const session = this.sessions.get(sessionId);
    const request = session?.get(requestId);
    if (request) {
      request.responseBody = body;
    }
  }

  finalize(session: RecordingSession): HARData {
    // Group requests by unique endpoint signature to ensure all unique APIs are included
    const uniqueEndpoints = this.groupUniqueEndpoints(session.requests);
    
    const entries: HAREntry[] = uniqueEndpoints
      .filter(req => req.status) // Only include completed requests
      .map(req => this.createHAREntry(req));

    console.log(`HAR Processor: Found ${uniqueEndpoints.length} unique endpoints from ${session.requests.length} total requests`);
    
    return {
      version: this.harVersion,
      creator: {
        name: 'XHRScribe',
        version: '1.0.0'
      },
      entries
    };
  }

  private groupUniqueEndpoints(requests: NetworkRequest[]): NetworkRequest[] {
    const endpointMap = new Map<string, NetworkRequest>();
    
    for (const request of requests) {
      try {
        // Create unique signature based on method + path (not full URL with query params)
        const url = new URL(request.url);
        let signature = `${request.method}:${url.pathname}`;
        
        // ENHANCED: Special handling for GraphQL endpoints
        if (this.isGraphQLEndpoint(url.pathname, request)) {
          const graphqlOperation = this.extractGraphQLOperation(request);
          if (graphqlOperation) {
            signature = `${request.method}:${url.pathname}:${graphqlOperation}`;
            console.log(`GraphQL operation detected: ${signature}`);
          }
        }
        
        // Keep the first occurrence of each unique endpoint
        // This ensures we capture all distinct API endpoints
        if (!endpointMap.has(signature)) {
          endpointMap.set(signature, request);
          console.log(`Unique endpoint detected: ${signature}`);
        }
      } catch (error) {
        console.warn(`Failed to parse URL for request: ${request.url}`, error);
        // Include requests with invalid URLs as they might still be valid for testing
        const fallbackSignature = `${request.method}:${request.url}`;
        if (!endpointMap.has(fallbackSignature)) {
          endpointMap.set(fallbackSignature, request);
        }
      }
    }
    
    return Array.from(endpointMap.values());
  }

  private isGraphQLEndpoint(pathname: string, request: NetworkRequest): boolean {
    return pathname.includes('graphql') || pathname.includes('gql') || 
           (request.requestBody && this.looksLikeGraphQL(request.requestBody));
  }

  private looksLikeGraphQL(requestBody: any): boolean {
    if (!requestBody) return false;
    
    try {
      const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
      const body = typeof requestBody === 'object' ? requestBody : JSON.parse(bodyStr);
      
      // Check for GraphQL query patterns
      return !!(body.query || body.operationName || body.variables || 
                bodyStr.includes('query ') || bodyStr.includes('mutation ') || 
                bodyStr.includes('subscription '));
    } catch {
      return false;
    }
  }

  private extractGraphQLOperation(request: NetworkRequest): string | null {
    if (!request.requestBody) return null;
    
    try {
      const bodyStr = typeof request.requestBody === 'string' ? request.requestBody : JSON.stringify(request.requestBody);
      const body = typeof request.requestBody === 'object' ? request.requestBody : JSON.parse(bodyStr);
      
      // Priority 1: Use operationName if available
      if (body.operationName && typeof body.operationName === 'string') {
        return body.operationName;
      }
      
      // Priority 2: Extract operation name from query string
      if (body.query && typeof body.query === 'string') {
        const queryMatch = body.query.match(/(?:query|mutation|subscription)\s+([a-zA-Z][a-zA-Z0-9_]*)/);
        if (queryMatch && queryMatch[1]) {
          return queryMatch[1];
        }
        
        // Priority 3: Use operation type + hash for unnamed operations
        const operationType = body.query.trim().match(/^(query|mutation|subscription)/);
        if (operationType) {
          const queryHash = this.simpleHash(body.query);
          return `${operationType[1]}_${queryHash}`;
        }
      }
      
      // Priority 4: Fallback to request body hash
      const bodyHash = this.simpleHash(bodyStr);
      return `operation_${bodyHash}`;
      
    } catch (error) {
      console.warn('Failed to extract GraphQL operation:', error);
      return null;
    }
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8);
  }

  private createHAREntry(request: NetworkRequest): HAREntry {
    const url = new URL(request.url);
    const queryString = Array.from(url.searchParams.entries()).map(([name, value]) => ({
      name,
      value
    }));

    const requestHeaders = this.formatHeaders(request.requestHeaders || {});
    const responseHeaders = this.formatHeaders(request.responseHeaders || {});
    
    // Extract cookies from request headers
    const requestCookies = this.extractCookiesFromHeaders(request.requestHeaders);
    // Extract cookies from response headers (Set-Cookie)
    const responseCookies = this.extractSetCookiesFromHeaders(request.responseHeaders);

    return {
      startedDateTime: new Date(request.timestamp).toISOString(),
      time: request.duration || 0,
      request: {
        method: request.method,
        url: request.url,
        httpVersion: 'HTTP/1.1',
        cookies: requestCookies,
        headers: requestHeaders,
        queryString,
        postData: request.requestBody ? {
          mimeType: this.getMimeType(request.requestHeaders),
          text: typeof request.requestBody === 'string' 
            ? request.requestBody 
            : JSON.stringify(request.requestBody)
        } : undefined,
        headersSize: -1,
        bodySize: request.requestBody ? 
          JSON.stringify(request.requestBody).length : 0
      },
      response: {
        status: request.status || 0,
        statusText: this.getStatusText(request.status),
        httpVersion: 'HTTP/1.1',
        cookies: responseCookies,
        headers: responseHeaders,
        content: {
          size: request.responseSize || 0,
          mimeType: this.getMimeType(request.responseHeaders),
          text: request.responseBody ? 
            (typeof request.responseBody === 'string' 
              ? request.responseBody 
              : JSON.stringify(request.responseBody)) : undefined
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

  private formatHeaders(headers: Record<string, string>): Array<{ name: string; value: string }> {
    return Object.entries(headers).map(([name, value]) => ({ name, value }));
  }

  private extractCookiesFromHeaders(headers?: Record<string, string>): Array<{ name: string; value: string; domain?: string; path?: string; httpOnly?: boolean; secure?: boolean }> {
    if (!headers) return [];
    
    // Look for Cookie header (case-insensitive)
    const cookieHeader = headers.cookie || headers.Cookie || headers.COOKIE;
    if (!cookieHeader) return [];

    // Parse cookie string: "name1=value1; name2=value2; name3=value3"
    return cookieHeader.split(';').map(cookie => {
      const [name, ...valueParts] = cookie.trim().split('=');
      const value = valueParts.join('='); // Handle values that contain '='
      return {
        name: name.trim(),
        value: value || '',
        domain: '', // Not available in request cookies
        path: '', // Not available in request cookies
        httpOnly: false, // Not available in request cookies
        secure: false // Not available in request cookies
      };
    }).filter(cookie => cookie.name); // Filter out empty names
  }

  private extractSetCookiesFromHeaders(headers?: Record<string, string>): Array<{ name: string; value: string; domain?: string; path?: string; httpOnly?: boolean; secure?: boolean }> {
    if (!headers) return [];
    
    // Look for Set-Cookie headers (case-insensitive)
    const setCookieHeaders: string[] = [];
    Object.entries(headers).forEach(([key, value]) => {
      if (key.toLowerCase() === 'set-cookie') {
        // Set-Cookie can be an array or single string
        if (Array.isArray(value)) {
          setCookieHeaders.push(...value);
        } else {
          setCookieHeaders.push(value);
        }
      }
    });

    return setCookieHeaders.map(cookieString => {
      // Parse Set-Cookie: "name=value; Domain=example.com; Path=/; HttpOnly; Secure"
      const parts = cookieString.split(';').map(part => part.trim());
      const [nameValue] = parts;
      const [name, ...valueParts] = nameValue.split('=');
      const value = valueParts.join('=');

      const cookie = {
        name: name.trim(),
        value: value || '',
        domain: '',
        path: '',
        httpOnly: false,
        secure: false
      };

      // Parse additional attributes
      parts.slice(1).forEach(part => {
        const [attr, attrValue] = part.split('=');
        const attrName = attr.toLowerCase();
        
        switch (attrName) {
          case 'domain':
            cookie.domain = attrValue || '';
            break;
          case 'path':
            cookie.path = attrValue || '';
            break;
          case 'httponly':
            cookie.httpOnly = true;
            break;
          case 'secure':
            cookie.secure = true;
            break;
        }
      });

      return cookie;
    }).filter(cookie => cookie.name); // Filter out invalid cookies
  }

  private getMimeType(headers?: Record<string, string>): string {
    if (!headers) return 'application/octet-stream';
    
    const contentType = headers['content-type'] || headers['Content-Type'];
    if (contentType) {
      return contentType.split(';')[0].trim();
    }
    
    return 'application/octet-stream';
  }

  private getStatusText(status?: number): string {
    const statusTexts: Record<number, string> = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      301: 'Moved Permanently',
      302: 'Found',
      304: 'Not Modified',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable'
    };

    return status ? (statusTexts[status] || '') : '';
  }

  // Stream processing for large HAR files
  async *streamEntries(session: RecordingSession): AsyncGenerator<HAREntry> {
    for (const request of session.requests) {
      if (request.status) {
        yield this.createHAREntry(request);
      }
    }
  }

  // Optimize memory usage by processing in chunks
  processInChunks(requests: NetworkRequest[], chunkSize = 100): HAREntry[][] {
    const chunks: HAREntry[][] = [];
    for (let i = 0; i < requests.length; i += chunkSize) {
      const chunk = requests.slice(i, i + chunkSize);
      chunks.push(chunk.map(req => this.createHAREntry(req)));
    }
    return chunks;
  }
}