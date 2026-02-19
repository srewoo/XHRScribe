import { SecurityTest, SecurityTestSuite } from './SecurityTestGenerator';
import { Logger } from '@/services/logging/Logger';

export interface SecurityTestResult {
  testId: string;
  testName: string;
  category: string;
  status: 'vulnerable' | 'safe' | 'error';
  responseStatus: number;
  responseTime: number;
  details: string;
}

export interface SecurityScanResult {
  endpoint: string;
  method: string;
  results: SecurityTestResult[];
  vulnerableCount: number;
  safeCount: number;
  errorCount: number;
}

export class SecurityTestRunner {
  private static instance: SecurityTestRunner;
  private abortController: AbortController | null = null;

  private constructor() {}

  static getInstance(): SecurityTestRunner {
    if (!SecurityTestRunner.instance) {
      SecurityTestRunner.instance = new SecurityTestRunner();
    }
    return SecurityTestRunner.instance;
  }

  async runSuite(
    suite: SecurityTestSuite,
    baseUrl: string,
    onProgress?: (current: number, total: number, result: SecurityTestResult) => void
  ): Promise<SecurityScanResult> {
    this.abortController = new AbortController();
    const results: SecurityTestResult[] = [];

    for (let i = 0; i < suite.tests.length; i++) {
      if (this.abortController?.signal.aborted) break;

      const test = suite.tests[i];
      const result = await this.executeTest(test, suite.endpoint, suite.method, baseUrl);
      results.push(result);

      if (onProgress) {
        onProgress(i + 1, suite.tests.length, result);
      }

      // Small delay between tests to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.abortController = null;

    return {
      endpoint: suite.endpoint,
      method: suite.method,
      results,
      vulnerableCount: results.filter(r => r.status === 'vulnerable').length,
      safeCount: results.filter(r => r.status === 'safe').length,
      errorCount: results.filter(r => r.status === 'error').length,
    };
  }

  private async executeTest(
    test: SecurityTest,
    endpoint: string,
    method: string,
    baseUrl: string
  ): Promise<SecurityTestResult> {
    const startTime = performance.now();
    // If endpoint is already a full URL, use it directly; otherwise concatenate with baseUrl
    let url: string;
    try {
      new URL(endpoint);
      url = endpoint;
    } catch {
      url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;
    }

    try {
      const fetchOptions: RequestInit = {
        method,
        signal: this.abortController?.signal,
        headers: { 'Content-Type': 'application/json' },
      };

      // Inject payload based on test type
      if (['POST', 'PUT', 'PATCH'].includes(method)) {
        fetchOptions.body = typeof test.payload === 'string'
          ? test.payload
          : JSON.stringify(test.payload);
      }

      const response = await fetch(url, fetchOptions);
      const responseTime = Math.round(performance.now() - startTime);

      // Determine if the endpoint is vulnerable based on response
      const status = this.assessVulnerability(test, response.status);

      return {
        testId: test.id,
        testName: test.name,
        category: test.category,
        status,
        responseStatus: response.status,
        responseTime,
        details: status === 'vulnerable'
          ? `Server returned ${response.status} - may be ${test.category} vulnerable`
          : `Server properly rejected with ${response.status}`,
      };
    } catch (error) {
      const responseTime = Math.round(performance.now() - startTime);
      Logger.getInstance().warn(`Security test failed: ${test.name}`, { error }, 'SecurityTestRunner');

      return {
        testId: test.id,
        testName: test.name,
        category: test.category,
        status: 'error',
        responseStatus: 0,
        responseTime,
        details: error instanceof Error ? error.message : 'Request failed',
      };
    }
  }

  private assessVulnerability(test: SecurityTest, statusCode: number): 'vulnerable' | 'safe' {
    // 4xx responses generally mean the server properly rejected the malicious input
    if (statusCode >= 400 && statusCode < 500) return 'safe';

    // 200 with security payloads could indicate vulnerability
    if (statusCode === 200) return 'vulnerable';

    // 500 could indicate the payload caused a server error (potential vulnerability)
    if (statusCode >= 500) return 'vulnerable';

    // 3xx redirects are generally safe
    if (statusCode >= 300 && statusCode < 400) return 'safe';

    return 'safe';
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
