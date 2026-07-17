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
  skippedCount: number;
}

export interface SecurityRunOptions {
  // The caller MUST confirm the user is authorized to actively scan this
  // target. This runner fires real (potentially state-changing) requests from
  // the user's authenticated browser context, so we refuse to run without it.
  authorized: boolean;
  // Off by default: destructive payloads (DROP/DELETE/TRUNCATE, time-delay,
  // shutdown) are skipped unless the user explicitly opts in.
  allowDestructive?: boolean;
}

// Payloads that could mutate or degrade the target if the endpoint is
// vulnerable. Skipped unless allowDestructive is set.
const DESTRUCTIVE_PAYLOAD = /\b(drop\s+table|truncate\s+table|delete\s+from|shutdown|waitfor\s+delay|benchmark\s*\(|pg_sleep|sleep\s*\(|rm\s+-rf|;\s*drop)\b/i;

// SSRF guard: refuse to fire attack payloads at loopback, private, link-local,
// or cloud-metadata hosts. The scanner runs from the user's authenticated
// browser context, so an internal target would let it attack the local network.
const CLOUD_METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', 'metadata']);
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (CLOUD_METADATA_HOSTS.has(host)) return true;
  // IPv6 loopback / unique-local / link-local
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
  // IPv4 ranges
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;                 // loopback / private / this-network
    if (a === 169 && b === 254) return true;                           // link-local (incl. metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;                  // private
    if (a === 192 && b === 168) return true;                           // private
  }
  return false;
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
    options: SecurityRunOptions,
    onProgress?: (current: number, total: number, result: SecurityTestResult) => void
  ): Promise<SecurityScanResult> {
    if (!options?.authorized) {
      throw new Error(
        'Active security scanning is disabled: the caller must confirm the user is authorized to scan this target.'
      );
    }
    // Only scan http(s) targets — never file:, chrome:, data:, etc.
    const targetForCheck = (() => {
      try { return new URL(suite.endpoint); } catch { /* relative */ }
      try { return new URL(baseUrl); } catch { return null; }
    })();
    if (targetForCheck && !/^https?:$/.test(targetForCheck.protocol)) {
      throw new Error(`Refusing to scan non-http(s) target: ${targetForCheck.protocol}`);
    }
    if (targetForCheck && isBlockedHost(targetForCheck.hostname)) {
      throw new Error(
        `Refusing to scan internal/loopback host: ${targetForCheck.hostname}. Active scanning is only allowed against external targets.`
      );
    }

    this.abortController = new AbortController();
    const results: SecurityTestResult[] = [];
    let skippedCount = 0;

    for (let i = 0; i < suite.tests.length; i++) {
      if (this.abortController?.signal.aborted) break;

      const test = suite.tests[i];

      // Skip destructive payloads unless the user explicitly opted in.
      if (!options.allowDestructive && DESTRUCTIVE_PAYLOAD.test(this.payloadValue(test.payload))) {
        skippedCount++;
        Logger.getInstance().info(
          `Skipped destructive security payload (non-destructive mode): ${test.name}`,
          null,
          'SecurityTestRunner'
        );
        continue;
      }

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
      skippedCount,
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

    // Defense in depth: block internal targets even if the per-test URL differs
    // from the suite endpoint validated in runSuite().
    try {
      if (isBlockedHost(new URL(url).hostname)) {
        return {
          testId: test.id,
          testName: test.name,
          category: test.category,
          status: 'error',
          responseStatus: 0,
          responseTime: 0,
          details: 'Skipped: internal/loopback target blocked by SSRF guard',
        };
      }
    } catch { /* if URL is unparseable, fetch below will reject it */ }

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
    // 2xx with no reflected payload, DB error, or timing signal is NOT evidence
    // of a vulnerability — many endpoints legitimately return 200 for any input.
    // Report as safe/inconclusive rather than manufacturing a false positive.
    if (statusCode >= 200 && statusCode < 300) {
      return {
        status: 'safe',
        confidence: 'low',
        evidence: `Endpoint returned HTTP ${statusCode} with no vulnerability signal (no reflected payload, DB error, or abnormal timing). Not flagged; confirm manually if the payload could be processed/stored asynchronously.`,
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
