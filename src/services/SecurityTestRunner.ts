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
  // Detail surfaced in the UI so a finding is actionable, not just a label.
  severity?: 'critical' | 'high' | 'medium' | 'low';
  description?: string;
  owaspReference?: string;
  method?: string;
  url?: string;
  payload?: string;        // the exact payload sent (stringified, truncated)
  evidence?: string;       // why this was flagged (response-derived)
  confidence?: 'high' | 'medium' | 'low';
  remediation?: string;    // how to fix this class of issue
}

// Fix guidance per OWASP category — shown alongside each finding.
const REMEDIATION: Record<string, string> = {
  injection:
    'Use parameterized queries / prepared statements; never concatenate user input into queries or commands. Validate and allowlist inputs, and apply least-privilege DB accounts.',
  xss:
    'Context-encode all output (HTML, attribute, JS, URL), set a strict Content-Security-Policy, and sanitize rich input with a vetted library (e.g. DOMPurify). Avoid innerHTML/dangerouslySetInnerHTML.',
  broken_auth:
    'Enforce strong authentication, short-lived rotating tokens, account lockout / rate limiting, and verify the session on every request server-side.',
  broken_access:
    'Enforce authorization on the server for every object/action (deny by default). Never rely on client-side checks or unguessable IDs.',
  sensitive_data:
    'Encrypt data in transit (TLS) and at rest, minimize what is collected/returned, and never expose secrets, tokens, or PII in responses or logs.',
  security_misconfig:
    'Harden headers (HSTS, X-Content-Type-Options, X-Frame-Options), disable verbose errors in prod, and remove default/sample endpoints.',
  xxe:
    'Disable external entity resolution in XML parsers and prefer safe formats (JSON). Patch/upgrade XML libraries.',
  insecure_deserialization:
    'Avoid deserializing untrusted data; use signed/whitelisted formats and integrity checks.',
  components:
    'Track and patch dependencies; run SCA (npm audit / Snyk / Trivy) and remove unused components.',
  logging:
    'Log security-relevant events with correlation IDs, alert on anomalies, and never log secrets/PII.',
};

const SQL_ERROR_SIGNATURES = [
  'sql syntax', 'sqlstate', 'ora-0', 'mysql_fetch', 'psql:', 'pg::', 'sqlite_',
  'syntax error at or near', 'unclosed quotation', 'odbc', 'native client',
  'you have an error in your sql', 'warning: mysql', 'quoted string not properly terminated',
];

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
      // Read a bounded slice of the body so we can derive real evidence
      // (reflected payloads, leaked SQL errors) rather than guessing from the
      // status code alone.
      const body = (await response.text().catch(() => '')).slice(0, 4000);

      const { status, evidence, confidence } = this.assessVulnerability(
        test, response.status, body, responseTime
      );

      return {
        testId: test.id,
        testName: test.name,
        category: test.category,
        status,
        responseStatus: response.status,
        responseTime,
        details: evidence,
        severity: test.severity,
        description: test.description,
        owaspReference: test.owaspReference,
        method,
        url,
        payload: this.stringifyPayload(test.payload),
        evidence,
        confidence,
        remediation: REMEDIATION[test.category] || 'Validate and sanitize all untrusted input; apply least privilege.',
      };
    } catch (error) {
      const responseTime = Math.round(performance.now() - startTime);
      Logger.getInstance().warn(`Security test failed: ${test.name}`, { error }, 'SecurityTestRunner');
      const msg = error instanceof Error ? error.message : 'Request failed';

      return {
        testId: test.id,
        testName: test.name,
        category: test.category,
        status: 'error',
        responseStatus: 0,
        responseTime,
        details: msg,
        severity: test.severity,
        description: test.description,
        owaspReference: test.owaspReference,
        method,
        url,
        payload: this.stringifyPayload(test.payload),
        evidence: `Request failed: ${msg} (often CORS or the endpoint being unreachable from the page context — not a confirmed vulnerability).`,
        confidence: 'low',
        remediation: REMEDIATION[test.category],
      };
    }
  }

  private stringifyPayload(payload: any): string {
    const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return s.length > 300 ? s.slice(0, 300) + '…' : s;
  }

  /** Extract the raw injected value (payload may be a string or { field: value }). */
  private payloadValue(payload: any): string {
    if (typeof payload === 'string') return payload;
    if (payload && typeof payload === 'object') {
      const vals = Object.values(payload).filter(v => typeof v === 'string') as string[];
      return vals[0] || JSON.stringify(payload);
    }
    return String(payload);
  }

  /**
   * Assess a response for the given test. Prefers response-content evidence
   * (reflected payload, leaked DB error, timing) over status-code guessing, and
   * reports a confidence level so low-signal status-only flags are clearly weaker.
   */
  private assessVulnerability(
    test: SecurityTest,
    statusCode: number,
    body: string,
    responseTime: number
  ): { status: 'vulnerable' | 'safe'; evidence: string; confidence: 'high' | 'medium' | 'low' } {
    const lowerBody = (body || '').toLowerCase();
    const payloadStr = this.payloadValue(test.payload);

    // High-confidence: reflected XSS — the exact payload comes back unescaped.
    if (test.category === 'xss' && payloadStr && body.includes(payloadStr)) {
      return {
        status: 'vulnerable',
        confidence: 'high',
        evidence: `The injected payload was reflected unescaped in the response body — a strong reflected-XSS indicator. Sent: ${payloadStr}`,
      };
    }

    // High-confidence: SQL error leaked, or a time-delay payload that actually delayed.
    if (test.category === 'injection') {
      const hit = SQL_ERROR_SIGNATURES.find(sig => lowerBody.includes(sig));
      if (hit) {
        return {
          status: 'vulnerable',
          confidence: 'high',
          evidence: `A database error message ("${hit}") leaked in the response after injecting \`${payloadStr}\` — strong SQL-injection signal.`,
        };
      }
      if (/wait|sleep|delay|benchmark/i.test(payloadStr) && responseTime > 4000) {
        return {
          status: 'vulnerable',
          confidence: 'high',
          evidence: `Response took ${responseTime}ms for a time-delay payload — likely time-based blind SQL injection.`,
        };
      }
    }

    // 4xx — server rejected the malicious input.
    if (statusCode >= 400 && statusCode < 500) {
      return { status: 'safe', confidence: 'medium', evidence: `Server rejected the payload with HTTP ${statusCode}.` };
    }
    // 5xx — payload may have broken server-side handling.
    if (statusCode >= 500) {
      return {
        status: 'vulnerable',
        confidence: 'medium',
        evidence: `Server returned HTTP ${statusCode} on the payload, suggesting the input was not handled safely. Confirm manually.`,
      };
    }
    // 3xx — not processed inline.
    if (statusCode >= 300 && statusCode < 400) {
      return { status: 'safe', confidence: 'low', evidence: `Redirect (HTTP ${statusCode}); payload not processed inline.` };
    }
    // 2xx with no stronger signal — weak. Accepted but unconfirmed.
    if (statusCode >= 200 && statusCode < 300) {
      return {
        status: 'vulnerable',
        confidence: 'low',
        evidence: `Endpoint accepted the payload and returned HTTP ${statusCode} without rejecting it. Weak signal — confirm manually whether the payload was actually processed/stored.`,
      };
    }
    return { status: 'safe', confidence: 'low', evidence: `HTTP ${statusCode}.` };
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}
