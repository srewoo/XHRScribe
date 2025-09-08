import { NetworkRequest } from '@/types';

export class DataMaskingService {
  private static instance: DataMaskingService;

  // Patterns for sensitive data detection
  private patterns = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    phone: /(\+\d{1,3}[-.\s]?)?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
    ssn: /\d{3}-\d{2}-\d{4}/g,
    creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    apiKey: /(api[_-]?key|apikey|api_secret|access[_-]?token|auth[_-]?token|authentication[_-]?token|bearer)\s*[:=]\s*["']?[a-zA-Z0-9\-._~+\/]{20,}["']?/gi,
    password: /(password|passwd|pwd|pass)\s*[:=]\s*["']?[^"'\s]{6,}["']?/gi,
    jwt: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    uuid: /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
    base64: /(?:[A-Za-z0-9+\/]{4}){10,}(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?/g,
  };

  private customPatterns: RegExp[] = [];

  private constructor() {}

  static getInstance(): DataMaskingService {
    if (!DataMaskingService.instance) {
      DataMaskingService.instance = new DataMaskingService();
    }
    return DataMaskingService.instance;
  }

  addCustomPattern(pattern: string): void {
    try {
      this.customPatterns.push(new RegExp(pattern, 'gi'));
    } catch (error) {
      console.error('Invalid regex pattern:', pattern);
    }
  }

  maskRequest(request: NetworkRequest, options?: MaskingOptions): NetworkRequest {
    const maskedRequest = { ...request };

    // Mask URL parameters
    maskedRequest.url = this.maskUrl(request.url, options);

    // Mask headers
    if (request.requestHeaders) {
      maskedRequest.requestHeaders = this.maskHeaders(request.requestHeaders, options);
    }

    if (request.responseHeaders) {
      maskedRequest.responseHeaders = this.maskHeaders(request.responseHeaders, options);
    }

    // Mask request body
    if (request.requestBody) {
      maskedRequest.requestBody = this.maskBody(request.requestBody, options);
    }

    // Mask response body
    if (request.responseBody) {
      maskedRequest.responseBody = this.maskBody(request.responseBody, options);
    }

    return maskedRequest;
  }

  private maskUrl(url: string, options?: MaskingOptions): string {
    try {
      const urlObj = new URL(url);
      
      // Mask query parameters
      const params = new URLSearchParams(urlObj.search);
      const maskedParams = new URLSearchParams();

      params.forEach((value, key) => {
        if (this.isSensitiveKey(key)) {
          maskedParams.set(key, '***MASKED***');
        } else {
          maskedParams.set(key, this.maskSensitiveData(value, options));
        }
      });

      urlObj.search = maskedParams.toString();
      return urlObj.toString();
    } catch {
      return this.maskSensitiveData(url, options);
    }
  }

  private maskHeaders(
    headers: Record<string, string>,
    options?: MaskingOptions
  ): Record<string, string> {
    const maskedHeaders: Record<string, string> = {};

    Object.entries(headers).forEach(([key, value]) => {
      const keyLower = key.toLowerCase();
      
      // Always mask authorization headers
      if (keyLower.includes('auth') || keyLower.includes('token') || keyLower === 'cookie') {
        maskedHeaders[key] = '***MASKED***';
      } else if (this.isSensitiveKey(key)) {
        maskedHeaders[key] = '***MASKED***';
      } else {
        maskedHeaders[key] = this.maskSensitiveData(value, options);
      }
    });

    return maskedHeaders;
  }

  private maskBody(body: any, options?: MaskingOptions): any {
    if (typeof body === 'string') {
      return this.maskSensitiveData(body, options);
    }

    if (typeof body === 'object' && body !== null) {
      return this.maskObject(body, options);
    }

    return body;
  }

  private maskObject(obj: any, options?: MaskingOptions): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.maskBody(item, options));
    }

    const masked: any = {};
    
    Object.entries(obj).forEach(([key, value]) => {
      if (this.isSensitiveKey(key)) {
        masked[key] = '***MASKED***';
      } else if (typeof value === 'string') {
        masked[key] = this.maskSensitiveData(value, options);
      } else if (typeof value === 'object' && value !== null) {
        masked[key] = this.maskObject(value, options);
      } else {
        masked[key] = value;
      }
    });

    return masked;
  }

  private maskSensitiveData(text: string, options?: MaskingOptions): string {
    if (!text || typeof text !== 'string') return text;

    let masked = text;

    // Apply default patterns
    if (options?.maskEmails !== false) {
      masked = masked.replace(this.patterns.email, '***EMAIL***');
    }

    if (options?.maskPhones !== false) {
      masked = masked.replace(this.patterns.phone, '***PHONE***');
    }

    if (options?.maskSSN !== false) {
      masked = masked.replace(this.patterns.ssn, '***SSN***');
    }

    if (options?.maskCreditCards !== false) {
      masked = masked.replace(this.patterns.creditCard, '***CARD***');
    }

    if (options?.maskApiKeys !== false) {
      masked = masked.replace(this.patterns.apiKey, '$1=***API_KEY***');
    }

    if (options?.maskPasswords !== false) {
      masked = masked.replace(this.patterns.password, '$1=***PASSWORD***');
    }

    if (options?.maskJWT !== false) {
      masked = masked.replace(this.patterns.jwt, '***JWT***');
    }

    if (options?.maskIPs !== false) {
      masked = masked.replace(this.patterns.ipAddress, (match) => {
        // Don't mask localhost
        if (match === '127.0.0.1' || match === '0.0.0.0') return match;
        return '***IP***';
      });
    }

    if (options?.maskUUIDs !== false) {
      masked = masked.replace(this.patterns.uuid, '***UUID***');
    }

    // Apply custom patterns
    this.customPatterns.forEach(pattern => {
      masked = masked.replace(pattern, '***CUSTOM***');
    });

    return masked;
  }

  private isSensitiveKey(key: string): boolean {
    const sensitiveKeys = [
      'password',
      'passwd',
      'pwd',
      'secret',
      'token',
      'api_key',
      'apikey',
      'auth',
      'authorization',
      'credit_card',
      'card_number',
      'cvv',
      'ssn',
      'social_security',
      'private_key',
      'encryption_key',
    ];

    const keyLower = key.toLowerCase();
    return sensitiveKeys.some(sensitive => keyLower.includes(sensitive));
  }

  detectSensitiveData(text: string): SensitiveDataReport {
    const report: SensitiveDataReport = {
      hasSensitiveData: false,
      types: [],
      count: 0,
      locations: [],
    };

    const checks = [
      { pattern: this.patterns.email, type: 'email' },
      { pattern: this.patterns.phone, type: 'phone' },
      { pattern: this.patterns.ssn, type: 'ssn' },
      { pattern: this.patterns.creditCard, type: 'creditCard' },
      { pattern: this.patterns.apiKey, type: 'apiKey' },
      { pattern: this.patterns.password, type: 'password' },
      { pattern: this.patterns.jwt, type: 'jwt' },
      { pattern: this.patterns.uuid, type: 'uuid' },
    ];

    checks.forEach(({ pattern, type }) => {
      const matches = text.match(pattern);
      if (matches) {
        report.hasSensitiveData = true;
        report.types.push(type);
        report.count += matches.length;
        
        matches.forEach(match => {
          const index = text.indexOf(match);
          report.locations.push({
            type,
            start: index,
            end: index + match.length,
            preview: this.getPreview(text, index, match.length),
          });
        });
      }
    });

    return report;
  }

  private getPreview(text: string, index: number, length: number): string {
    const contextLength = 20;
    const start = Math.max(0, index - contextLength);
    const end = Math.min(text.length, index + length + contextLength);
    
    let preview = text.substring(start, end);
    if (start > 0) preview = '...' + preview;
    if (end < text.length) preview = preview + '...';
    
    return preview;
  }
}

interface MaskingOptions {
  maskEmails?: boolean;
  maskPhones?: boolean;
  maskSSN?: boolean;
  maskCreditCards?: boolean;
  maskApiKeys?: boolean;
  maskPasswords?: boolean;
  maskJWT?: boolean;
  maskIPs?: boolean;
  maskUUIDs?: boolean;
}

interface SensitiveDataReport {
  hasSensitiveData: boolean;
  types: string[];
  count: number;
  locations: Array<{
    type: string;
    start: number;
    end: number;
    preview: string;
  }>;
}