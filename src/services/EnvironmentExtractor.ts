import { RecordingSession, NetworkRequest } from '@/types';

export interface ExtractedVariable {
  name: string;
  value: string;
  type: 'url' | 'token' | 'id' | 'email' | 'api_key' | 'secret' | 'host' | 'port' | 'path' | 'custom';
  source: 'request_url' | 'request_header' | 'request_body' | 'response_body';
  occurrences: number;
  confidence: number; // 0-100
}

export interface EnvironmentConfig {
  name: string;
  variables: Record<string, string>;
}

export interface ExtractionResult {
  variables: ExtractedVariable[];
  envFile: string;
  environments: {
    development: EnvironmentConfig;
    staging: EnvironmentConfig;
    production: EnvironmentConfig;
  };
  templateCode: string;
}

export class EnvironmentExtractor {
  private static instance: EnvironmentExtractor;

  private constructor() {}

  static getInstance(): EnvironmentExtractor {
    if (!EnvironmentExtractor.instance) {
      EnvironmentExtractor.instance = new EnvironmentExtractor();
    }
    return EnvironmentExtractor.instance;
  }

  extractVariables(session: RecordingSession): ExtractionResult {
    const variableMap = new Map<string, ExtractedVariable>();

    session.requests.forEach(request => {
      this.extractFromUrl(request, variableMap);
      this.extractFromHeaders(request, variableMap);
      this.extractFromBody(request, variableMap);
      this.extractFromResponse(request, variableMap);
    });

    const variables = Array.from(variableMap.values())
      .sort((a, b) => b.confidence - a.confidence);

    return {
      variables,
      envFile: this.generateEnvFile(variables),
      environments: this.generateEnvironments(variables, session),
      templateCode: this.generateTemplateCode(variables)
    };
  }

  private extractFromUrl(request: NetworkRequest, variableMap: Map<string, ExtractedVariable>): void {
    try {
      const url = new URL(request.url);

      // Extract base URL / host
      const hostKey = 'BASE_URL';
      const hostValue = `${url.protocol}//${url.host}`;
      this.addOrUpdateVariable(variableMap, {
        name: hostKey,
        value: hostValue,
        type: 'url',
        source: 'request_url',
        occurrences: 1,
        confidence: 95
      });

      // Extract API path patterns
      const pathParts = url.pathname.split('/').filter(Boolean);

      // Detect IDs in path (UUIDs, numeric IDs)
      pathParts.forEach((part, index) => {
        if (this.isUUID(part)) {
          const varName = this.inferIdName(pathParts, index, 'UUID');
          this.addOrUpdateVariable(variableMap, {
            name: varName,
            value: part,
            type: 'id',
            source: 'request_url',
            occurrences: 1,
            confidence: 85
          });
        } else if (this.isNumericId(part)) {
          const varName = this.inferIdName(pathParts, index, 'ID');
          this.addOrUpdateVariable(variableMap, {
            name: varName,
            value: part,
            type: 'id',
            source: 'request_url',
            occurrences: 1,
            confidence: 80
          });
        }
      });

      // Extract query parameters
      url.searchParams.forEach((value, key) => {
        if (this.isSensitiveParam(key)) {
          const varName = this.toEnvVarName(key);
          this.addOrUpdateVariable(variableMap, {
            name: varName,
            value: value,
            type: this.detectValueType(key, value),
            source: 'request_url',
            occurrences: 1,
            confidence: 75
          });
        }
      });
    } catch (error) {
      // Invalid URL, skip
    }
  }

  private extractFromHeaders(request: NetworkRequest, variableMap: Map<string, ExtractedVariable>): void {
    if (!request.requestHeaders) return;

    const sensitiveHeaders = [
      'authorization', 'x-api-key', 'x-auth-token', 'x-access-token',
      'api-key', 'bearer', 'x-csrf-token', 'x-request-id'
    ];

    Object.entries(request.requestHeaders).forEach(([key, value]) => {
      const lowerKey = key.toLowerCase();

      if (sensitiveHeaders.some(h => lowerKey.includes(h))) {
        let varName = this.toEnvVarName(key);
        let varType: ExtractedVariable['type'] = 'token';

        if (lowerKey.includes('authorization')) {
          varName = 'AUTH_TOKEN';
          // Extract bearer token if present
          if (typeof value === 'string' && value.toLowerCase().startsWith('bearer ')) {
            this.addOrUpdateVariable(variableMap, {
              name: varName,
              value: value.substring(7),
              type: 'token',
              source: 'request_header',
              occurrences: 1,
              confidence: 95
            });
            return;
          }
        }

        if (lowerKey.includes('api-key') || lowerKey.includes('apikey')) {
          varName = 'API_KEY';
          varType = 'api_key';
        }

        this.addOrUpdateVariable(variableMap, {
          name: varName,
          value: String(value),
          type: varType,
          source: 'request_header',
          occurrences: 1,
          confidence: 90
        });
      }
    });
  }

  private extractFromBody(request: NetworkRequest, variableMap: Map<string, ExtractedVariable>): void {
    if (!request.requestBody) return;

    try {
      const body = typeof request.requestBody === 'string'
        ? JSON.parse(request.requestBody)
        : request.requestBody;

      this.extractFromObject(body, variableMap, 'request_body');
    } catch {
      // Not JSON, skip
    }
  }

  private extractFromResponse(request: NetworkRequest, variableMap: Map<string, ExtractedVariable>): void {
    if (!request.responseBody) return;

    try {
      const body = typeof request.responseBody === 'string'
        ? JSON.parse(request.responseBody)
        : request.responseBody;

      // Look for tokens in response (login responses)
      if (body.token || body.access_token || body.accessToken) {
        const tokenValue = body.token || body.access_token || body.accessToken;
        this.addOrUpdateVariable(variableMap, {
          name: 'AUTH_TOKEN',
          value: tokenValue,
          type: 'token',
          source: 'response_body',
          occurrences: 1,
          confidence: 95
        });
      }

      if (body.refresh_token || body.refreshToken) {
        const refreshValue = body.refresh_token || body.refreshToken;
        this.addOrUpdateVariable(variableMap, {
          name: 'REFRESH_TOKEN',
          value: refreshValue,
          type: 'token',
          source: 'response_body',
          occurrences: 1,
          confidence: 90
        });
      }

      // Extract user IDs from login response
      if (body.user?.id || body.userId || body.user_id) {
        const userId = body.user?.id || body.userId || body.user_id;
        this.addOrUpdateVariable(variableMap, {
          name: 'USER_ID',
          value: String(userId),
          type: 'id',
          source: 'response_body',
          occurrences: 1,
          confidence: 85
        });
      }
    } catch {
      // Not JSON, skip
    }
  }

  private extractFromObject(
    obj: any,
    variableMap: Map<string, ExtractedVariable>,
    source: ExtractedVariable['source'],
    prefix: string = ''
  ): void {
    if (!obj || typeof obj !== 'object') return;

    const sensitiveKeys = [
      'password', 'email', 'username', 'user', 'token', 'api_key', 'apiKey',
      'secret', 'key', 'credential', 'auth', 'access_token', 'refresh_token'
    ];

    Object.entries(obj).forEach(([key, value]) => {
      const fullKey = prefix ? `${prefix}_${key}` : key;
      const lowerKey = key.toLowerCase();

      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        if (typeof value === 'string' && value.length > 0) {
          const varName = this.toEnvVarName(fullKey);
          this.addOrUpdateVariable(variableMap, {
            name: varName,
            value: value,
            type: this.detectValueType(key, value),
            source,
            occurrences: 1,
            confidence: 80
          });
        }
      }

      // Recurse into nested objects
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.extractFromObject(value, variableMap, source, fullKey);
      }
    });
  }

  private addOrUpdateVariable(
    variableMap: Map<string, ExtractedVariable>,
    variable: ExtractedVariable
  ): void {
    const existing = variableMap.get(variable.name);
    if (existing) {
      existing.occurrences++;
      existing.confidence = Math.min(100, existing.confidence + 5);
    } else {
      variableMap.set(variable.name, variable);
    }
  }

  private isUUID(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  private isNumericId(value: string): boolean {
    return /^\d{2,}$/.test(value);
  }

  private isSensitiveParam(key: string): boolean {
    const sensitiveParams = ['token', 'key', 'api_key', 'apikey', 'secret', 'auth', 'session'];
    return sensitiveParams.some(sp => key.toLowerCase().includes(sp));
  }

  private inferIdName(pathParts: string[], index: number, suffix: string): string {
    // Try to get the previous path segment as the entity name
    if (index > 0) {
      const entityName = pathParts[index - 1];
      // Singularize if it ends with 's'
      const singular = entityName.endsWith('s') ? entityName.slice(0, -1) : entityName;
      return this.toEnvVarName(`${singular}_${suffix}`);
    }
    return `ENTITY_${suffix}`;
  }

  private toEnvVarName(key: string): string {
    return key
      .replace(/([a-z])([A-Z])/g, '$1_$2') // camelCase to snake_case
      .replace(/[^a-zA-Z0-9_]/g, '_') // Replace special chars
      .replace(/_+/g, '_') // Remove duplicate underscores
      .toUpperCase()
      .replace(/^_|_$/g, ''); // Trim leading/trailing underscores
  }

  private detectValueType(key: string, value: string): ExtractedVariable['type'] {
    const lowerKey = key.toLowerCase();

    if (lowerKey.includes('email') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return 'email';
    }
    if (lowerKey.includes('token') || lowerKey.includes('bearer')) {
      return 'token';
    }
    if (lowerKey.includes('api_key') || lowerKey.includes('apikey')) {
      return 'api_key';
    }
    if (lowerKey.includes('secret') || lowerKey.includes('password')) {
      return 'secret';
    }
    if (lowerKey.includes('host') || lowerKey.includes('url')) {
      return 'url';
    }
    if (this.isUUID(value) || this.isNumericId(value)) {
      return 'id';
    }

    return 'custom';
  }

  generateEnvFile(variables: ExtractedVariable[]): string {
    const lines: string[] = [
      '# Environment Variables - Generated by XHRScribe',
      '# Copy this file to .env and update values as needed',
      ''
    ];

    // Group by type
    const grouped = this.groupVariablesByType(variables);

    Object.entries(grouped).forEach(([type, vars]) => {
      lines.push(`# ${this.formatTypeHeader(type)}`);
      vars.forEach(v => {
        const maskedValue = this.maskSensitiveValue(v);
        lines.push(`${v.name}=${maskedValue}`);
      });
      lines.push('');
    });

    return lines.join('\n');
  }

  private groupVariablesByType(variables: ExtractedVariable[]): Record<string, ExtractedVariable[]> {
    const grouped: Record<string, ExtractedVariable[]> = {};

    variables.forEach(v => {
      if (!grouped[v.type]) {
        grouped[v.type] = [];
      }
      grouped[v.type].push(v);
    });

    return grouped;
  }

  private formatTypeHeader(type: string): string {
    const headers: Record<string, string> = {
      url: 'URLs & Endpoints',
      token: 'Authentication Tokens',
      api_key: 'API Keys',
      secret: 'Secrets (DO NOT COMMIT)',
      id: 'Resource IDs',
      email: 'Email Addresses',
      host: 'Hosts',
      port: 'Ports',
      path: 'Paths',
      custom: 'Other Variables'
    };
    return headers[type] || 'Other Variables';
  }

  private maskSensitiveValue(variable: ExtractedVariable): string {
    const sensitiveTypes: ExtractedVariable['type'][] = ['token', 'api_key', 'secret'];

    if (sensitiveTypes.includes(variable.type)) {
      if (variable.value.length > 8) {
        return variable.value.substring(0, 4) + '****' + variable.value.substring(variable.value.length - 4);
      }
      return '****';
    }

    return variable.value;
  }

  generateEnvironments(variables: ExtractedVariable[], session: RecordingSession): ExtractionResult['environments'] {
    const baseUrl = variables.find(v => v.name === 'BASE_URL');
    let devUrl = 'http://localhost:3000';
    let stagingUrl = 'https://staging.example.com';
    let prodUrl = 'https://api.example.com';

    if (baseUrl) {
      try {
        const url = new URL(baseUrl.value);
        const host = url.hostname;

        if (host.includes('localhost') || host.includes('127.0.0.1')) {
          devUrl = baseUrl.value;
        } else if (host.includes('staging') || host.includes('stg') || host.includes('dev')) {
          stagingUrl = baseUrl.value;
        } else {
          prodUrl = baseUrl.value;
        }
      } catch {
        // Use defaults
      }
    }

    const createEnvConfig = (name: string, baseUrl: string): EnvironmentConfig => {
      const vars: Record<string, string> = { BASE_URL: baseUrl };

      variables.forEach(v => {
        if (v.name !== 'BASE_URL') {
          vars[v.name] = `{{${v.name}}}`;
        }
      });

      return { name, variables: vars };
    };

    return {
      development: createEnvConfig('development', devUrl),
      staging: createEnvConfig('staging', stagingUrl),
      production: createEnvConfig('production', prodUrl)
    };
  }

  generateTemplateCode(variables: ExtractedVariable[]): string {
    const lines: string[] = [
      '// Environment variable configuration',
      '// Usage: import { env } from \'./env\';',
      '',
      'const env = {',
    ];

    variables.forEach((v, index) => {
      const comma = index < variables.length - 1 ? ',' : '';
      const defaultValue = v.type === 'url' ? `'${v.value}'` : "''";
      lines.push(`  ${this.toCamelCase(v.name)}: process.env.${v.name} || ${defaultValue}${comma}`);
    });

    lines.push('};');
    lines.push('');
    lines.push('export default env;');

    return lines.join('\n');
  }

  private toCamelCase(str: string): string {
    return str.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  replaceHardcodedValues(code: string, variables: ExtractedVariable[]): string {
    let result = code;

    variables.forEach(variable => {
      // Replace exact string matches with environment variable references
      const escapedValue = variable.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(['"\`])${escapedValue}\\1`, 'g');
      result = result.replace(regex, `process.env.${variable.name}`);

      // Also replace in template literals
      const templateRegex = new RegExp(`\\\${\\s*['"\`]${escapedValue}['"\`]\\s*}`, 'g');
      result = result.replace(templateRegex, `\${process.env.${variable.name}}`);
    });

    return result;
  }
}
