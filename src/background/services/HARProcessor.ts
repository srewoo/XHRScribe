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
        const signature = `${request.method}:${url.pathname}`;
        
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

  private createHAREntry(request: NetworkRequest): HAREntry {
    const url = new URL(request.url);
    const queryString = Array.from(url.searchParams.entries()).map(([name, value]) => ({
      name,
      value
    }));

    const requestHeaders = this.formatHeaders(request.requestHeaders || {});
    const responseHeaders = this.formatHeaders(request.responseHeaders || {});

    return {
      startedDateTime: new Date(request.timestamp).toISOString(),
      time: request.duration || 0,
      request: {
        method: request.method,
        url: request.url,
        httpVersion: 'HTTP/1.1',
        cookies: [],
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
        cookies: [],
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