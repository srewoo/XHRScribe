import { RecordingSession, NetworkRequest } from '@/types';

export interface OpenAPISchema {
  type: string;
  format?: string;
  description?: string;
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  required?: string[];
  enum?: any[];
  example?: any;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  nullable?: boolean;
}

export interface OpenAPIParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required: boolean;
  schema: OpenAPISchema;
  description?: string;
  example?: any;
}

export interface OpenAPIRequestBody {
  required: boolean;
  content: Record<string, { schema: OpenAPISchema; example?: any }>;
}

export interface OpenAPIResponse {
  description: string;
  content?: Record<string, { schema: OpenAPISchema; example?: any }>;
  headers?: Record<string, { schema: OpenAPISchema; description?: string }>;
}

export interface OpenAPIOperation {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: Record<string, OpenAPIResponse>;
  security?: any[];
}

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers: Array<{ url: string; description?: string }>;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components: {
    schemas: Record<string, OpenAPISchema>;
    securitySchemes?: Record<string, any>;
  };
  tags?: Array<{ name: string; description?: string }>;
}

export class SchemaExtractor {
  private static instance: SchemaExtractor;
  private schemaCache: Map<string, OpenAPISchema> = new Map();

  private constructor() {}

  static getInstance(): SchemaExtractor {
    if (!SchemaExtractor.instance) {
      SchemaExtractor.instance = new SchemaExtractor();
    }
    return SchemaExtractor.instance;
  }

  extractOpenAPISpec(session: RecordingSession): OpenAPISpec {
    const paths: Record<string, Record<string, OpenAPIOperation>> = {};
    const schemas: Record<string, OpenAPISchema> = {};
    const tags = new Set<string>();
    const servers = new Set<string>();

    // Group requests by normalized path
    const groupedRequests = this.groupRequestsByPath(session.requests);

    groupedRequests.forEach((requests, pathPattern) => {
      if (!paths[pathPattern]) {
        paths[pathPattern] = {};
      }

      // Group by method
      const methodGroups = new Map<string, NetworkRequest[]>();
      requests.forEach(req => {
        const method = req.method.toLowerCase();
        if (!methodGroups.has(method)) {
          methodGroups.set(method, []);
        }
        methodGroups.get(method)!.push(req);
      });

      methodGroups.forEach((methodRequests, method) => {
        const operation = this.createOperation(methodRequests, pathPattern, schemas);
        paths[pathPattern][method] = operation;

        // Collect tags
        operation.tags.forEach(tag => tags.add(tag));

        // Collect server URLs
        try {
          const url = new URL(methodRequests[0].url);
          servers.add(`${url.protocol}//${url.host}`);
        } catch {
          // Skip invalid URLs
        }
      });
    });

    return {
      openapi: '3.1.0',
      info: {
        title: session.name || 'API Specification',
        version: '1.0.0',
        description: `Generated from XHRScribe recording on ${new Date(session.startTime).toLocaleString()}`
      },
      servers: Array.from(servers).map(url => ({ url })),
      paths,
      components: {
        schemas,
        securitySchemes: this.detectSecuritySchemes(session.requests)
      },
      tags: Array.from(tags).map(name => ({
        name,
        description: `Operations related to ${name}`
      }))
    };
  }

  private groupRequestsByPath(requests: NetworkRequest[]): Map<string, NetworkRequest[]> {
    const groups = new Map<string, NetworkRequest[]>();

    requests.forEach(request => {
      try {
        const url = new URL(request.url);
        const pathPattern = this.normalizePathPattern(url.pathname);

        if (!groups.has(pathPattern)) {
          groups.set(pathPattern, []);
        }
        groups.get(pathPattern)!.push(request);
      } catch {
        // Skip invalid URLs
      }
    });

    return groups;
  }

  private normalizePathPattern(pathname: string): string {
    const parts = pathname.split('/').filter(Boolean);

    return '/' + parts.map(part => {
      // Detect UUIDs
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)) {
        return '{id}';
      }
      // Detect numeric IDs
      if (/^\d+$/.test(part)) {
        return '{id}';
      }
      // Detect MongoDB ObjectIds
      if (/^[0-9a-f]{24}$/i.test(part)) {
        return '{id}';
      }
      return part;
    }).join('/');
  }

  private createOperation(requests: NetworkRequest[], pathPattern: string, schemas: Record<string, OpenAPISchema>): OpenAPIOperation {
    const firstRequest = requests[0];
    const method = firstRequest.method;

    // Extract path parameters
    const pathParams = this.extractPathParameters(pathPattern);

    // Extract query parameters from all requests
    const queryParams = this.extractQueryParameters(requests);

    // Extract header parameters
    const headerParams = this.extractHeaderParameters(requests);

    // Generate request body schema
    const requestBody = this.extractRequestBody(requests, schemas);

    // Generate response schemas
    const responses = this.extractResponses(requests, schemas);

    // Generate operation ID and tags
    const { operationId, tags } = this.generateOperationMetadata(method, pathPattern);

    return {
      operationId,
      summary: `${method} ${pathPattern}`,
      tags,
      parameters: [...pathParams, ...queryParams, ...headerParams],
      requestBody: requestBody || undefined,
      responses,
      security: this.detectOperationSecurity(requests)
    };
  }

  private extractPathParameters(pathPattern: string): OpenAPIParameter[] {
    const params: OpenAPIParameter[] = [];
    const matches = pathPattern.match(/\{([^}]+)\}/g);

    if (matches) {
      matches.forEach(match => {
        const name = match.slice(1, -1);
        params.push({
          name,
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: `${name} parameter`
        });
      });
    }

    return params;
  }

  private extractQueryParameters(requests: NetworkRequest[]): OpenAPIParameter[] {
    const paramMap = new Map<string, { values: Set<string>; required: boolean }>();

    requests.forEach(request => {
      try {
        const url = new URL(request.url);
        url.searchParams.forEach((value, key) => {
          if (!paramMap.has(key)) {
            paramMap.set(key, { values: new Set(), required: true });
          }
          paramMap.get(key)!.values.add(value);
        });

        // Mark as not required if some requests don't have the param
        paramMap.forEach((data, key) => {
          if (!url.searchParams.has(key)) {
            data.required = false;
          }
        });
      } catch {
        // Skip invalid URLs
      }
    });

    return Array.from(paramMap.entries()).map(([name, data]) => ({
      name,
      in: 'query' as const,
      required: data.required,
      schema: this.inferSchemaFromValues(Array.from(data.values)),
      example: Array.from(data.values)[0]
    }));
  }

  private extractHeaderParameters(requests: NetworkRequest[]): OpenAPIParameter[] {
    const commonHeaders = ['authorization', 'x-api-key', 'x-request-id', 'content-type', 'accept'];
    const params: OpenAPIParameter[] = [];

    const headerValues = new Map<string, Set<string>>();

    requests.forEach(request => {
      if (request.requestHeaders) {
        Object.entries(request.requestHeaders).forEach(([key, value]) => {
          const lowerKey = key.toLowerCase();
          if (commonHeaders.includes(lowerKey) && lowerKey !== 'content-type' && lowerKey !== 'accept') {
            if (!headerValues.has(key)) {
              headerValues.set(key, new Set());
            }
            headerValues.get(key)!.add(String(value));
          }
        });
      }
    });

    headerValues.forEach((values, name) => {
      params.push({
        name,
        in: 'header',
        required: name.toLowerCase().includes('authorization'),
        schema: { type: 'string' },
        description: `${name} header`
      });
    });

    return params;
  }

  private extractRequestBody(requests: NetworkRequest[], schemas: Record<string, OpenAPISchema>): OpenAPIRequestBody | null {
    const requestsWithBody = requests.filter(r => r.requestBody);
    if (requestsWithBody.length === 0) return null;

    // Merge schemas from all request bodies
    const mergedSchema = this.mergeSchemas(
      requestsWithBody.map(r => this.inferSchema(r.requestBody))
    );

    // Generate schema name and store in components
    const schemaName = this.generateSchemaName(requests[0], 'Request');
    schemas[schemaName] = mergedSchema;

    return {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: `#/components/schemas/${schemaName}` } as any,
          example: requestsWithBody[0].requestBody
        }
      }
    };
  }

  private extractResponses(requests: NetworkRequest[], schemas: Record<string, OpenAPISchema>): Record<string, OpenAPIResponse> {
    const responses: Record<string, OpenAPIResponse> = {};
    const statusGroups = new Map<number, NetworkRequest[]>();

    requests.forEach(request => {
      const status = request.status || 200;
      if (!statusGroups.has(status)) {
        statusGroups.set(status, []);
      }
      statusGroups.get(status)!.push(request);
    });

    statusGroups.forEach((statusRequests, status) => {
      const requestsWithBody = statusRequests.filter(r => r.responseBody);

      if (requestsWithBody.length > 0) {
        const mergedSchema = this.mergeSchemas(
          requestsWithBody.map(r => this.inferSchema(r.responseBody))
        );

        const schemaName = this.generateSchemaName(statusRequests[0], `Response${status}`);
        schemas[schemaName] = mergedSchema;

        responses[String(status)] = {
          description: this.getStatusDescription(status),
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${schemaName}` } as any,
              example: requestsWithBody[0].responseBody
            }
          }
        };
      } else {
        responses[String(status)] = {
          description: this.getStatusDescription(status)
        };
      }
    });

    return responses;
  }

  inferSchema(data: any): OpenAPISchema {
    if (data === null) {
      return { type: 'null', nullable: true };
    }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return { type: 'array', items: { type: 'object' } };
      }
      return {
        type: 'array',
        items: this.inferSchema(data[0])
      };
    }

    if (typeof data === 'object') {
      const properties: Record<string, OpenAPISchema> = {};
      const required: string[] = [];

      Object.entries(data).forEach(([key, value]) => {
        properties[key] = this.inferSchema(value);
        if (value !== null && value !== undefined) {
          required.push(key);
        }
      });

      return {
        type: 'object',
        properties,
        required: required.length > 0 ? required : undefined
      };
    }

    if (typeof data === 'string') {
      return this.inferStringSchema(data);
    }

    if (typeof data === 'number') {
      return Number.isInteger(data)
        ? { type: 'integer', example: data }
        : { type: 'number', example: data };
    }

    if (typeof data === 'boolean') {
      return { type: 'boolean', example: data };
    }

    return { type: 'string' };
  }

  private inferStringSchema(value: string): OpenAPISchema {
    // UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return { type: 'string', format: 'uuid', example: value };
    }

    // Email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { type: 'string', format: 'email', example: value };
    }

    // Date-time (ISO 8601)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
      return { type: 'string', format: 'date-time', example: value };
    }

    // Date
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { type: 'string', format: 'date', example: value };
    }

    // URI
    if (/^https?:\/\//.test(value)) {
      return { type: 'string', format: 'uri', example: value };
    }

    // Phone
    if (/^\+?[\d\s\-()]{10,}$/.test(value)) {
      return { type: 'string', format: 'phone', example: value };
    }

    return { type: 'string', example: value };
  }

  private inferSchemaFromValues(values: string[]): OpenAPISchema {
    // Check if all values are numeric
    if (values.every(v => !isNaN(Number(v)))) {
      const nums = values.map(Number);
      if (nums.every(n => Number.isInteger(n))) {
        return { type: 'integer', example: nums[0] };
      }
      return { type: 'number', example: nums[0] };
    }

    // Check if all values are booleans
    if (values.every(v => v === 'true' || v === 'false')) {
      return { type: 'boolean', example: values[0] === 'true' };
    }

    // Check if limited set of values (enum)
    if (values.length <= 10 && new Set(values).size <= 5) {
      return { type: 'string', enum: Array.from(new Set(values)) };
    }

    return { type: 'string', example: values[0] };
  }

  private mergeSchemas(schemas: OpenAPISchema[]): OpenAPISchema {
    if (schemas.length === 0) {
      return { type: 'object' };
    }

    if (schemas.length === 1) {
      return schemas[0];
    }

    // For arrays, merge item schemas
    if (schemas[0].type === 'array') {
      const itemSchemas = schemas
        .filter(s => s.items)
        .map(s => s.items!);
      return {
        type: 'array',
        items: this.mergeSchemas(itemSchemas)
      };
    }

    // For objects, merge properties
    if (schemas[0].type === 'object') {
      const allProperties: Record<string, OpenAPISchema[]> = {};
      const allRequired = new Set<string>();

      schemas.forEach(schema => {
        if (schema.properties) {
          Object.entries(schema.properties).forEach(([key, value]) => {
            if (!allProperties[key]) {
              allProperties[key] = [];
            }
            allProperties[key].push(value);
          });
        }
        if (schema.required) {
          schema.required.forEach(r => allRequired.add(r));
        }
      });

      const mergedProperties: Record<string, OpenAPISchema> = {};
      Object.entries(allProperties).forEach(([key, propSchemas]) => {
        mergedProperties[key] = this.mergeSchemas(propSchemas);
      });

      // Only include in required if present in all schemas
      const required = Array.from(allRequired).filter(r =>
        schemas.every(s => s.properties && r in s.properties)
      );

      return {
        type: 'object',
        properties: mergedProperties,
        required: required.length > 0 ? required : undefined
      };
    }

    return schemas[0];
  }

  private generateSchemaName(request: NetworkRequest, suffix: string): string {
    try {
      const url = new URL(request.url);
      const pathParts = url.pathname.split('/').filter(Boolean);

      // Get meaningful parts (skip IDs)
      const meaningfulParts = pathParts.filter(part =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) &&
        !/^\d+$/.test(part)
      );

      if (meaningfulParts.length > 0) {
        const name = meaningfulParts
          .map(p => p.charAt(0).toUpperCase() + p.slice(1))
          .join('');
        return `${name}${suffix}`;
      }
    } catch {
      // Fallback
    }

    return `Anonymous${suffix}${Date.now()}`;
  }

  private generateOperationMetadata(method: string, path: string): { operationId: string; tags: string[] } {
    const pathParts = path.split('/').filter(Boolean);

    // First meaningful path segment is the tag
    const tag = pathParts.find(p => !p.startsWith('{')) || 'default';

    // Generate operation ID
    const cleanPath = pathParts
      .map(p => p.startsWith('{') ? 'ById' : p.charAt(0).toUpperCase() + p.slice(1))
      .join('');

    const operationId = `${method.toLowerCase()}${cleanPath}`;

    return { operationId, tags: [tag] };
  }

  private getStatusDescription(status: number): string {
    const descriptions: Record<number, string> = {
      200: 'Successful response',
      201: 'Resource created',
      204: 'No content',
      400: 'Bad request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not found',
      409: 'Conflict',
      422: 'Unprocessable entity',
      500: 'Internal server error'
    };
    return descriptions[status] || `Status ${status}`;
  }

  private detectSecuritySchemes(requests: NetworkRequest[]): Record<string, any> {
    const schemes: Record<string, any> = {};

    requests.forEach(request => {
      if (request.requestHeaders) {
        const authHeader = Object.entries(request.requestHeaders)
          .find(([key]) => key.toLowerCase() === 'authorization');

        if (authHeader) {
          const [, value] = authHeader;
          if (typeof value === 'string') {
            if (value.toLowerCase().startsWith('bearer ')) {
              schemes['bearerAuth'] = {
                type: 'http',
                scheme: 'bearer',
                bearerFormat: 'JWT'
              };
            } else if (value.toLowerCase().startsWith('basic ')) {
              schemes['basicAuth'] = {
                type: 'http',
                scheme: 'basic'
              };
            }
          }
        }

        const apiKey = Object.entries(request.requestHeaders)
          .find(([key]) => key.toLowerCase().includes('api-key') || key.toLowerCase().includes('apikey'));

        if (apiKey) {
          schemes['apiKeyAuth'] = {
            type: 'apiKey',
            in: 'header',
            name: apiKey[0]
          };
        }
      }
    });

    return Object.keys(schemes).length > 0 ? schemes : undefined as any;
  }

  private detectOperationSecurity(requests: NetworkRequest[]): any[] | undefined {
    const hasAuth = requests.some(r =>
      r.requestHeaders &&
      Object.keys(r.requestHeaders).some(k =>
        k.toLowerCase() === 'authorization' ||
        k.toLowerCase().includes('api-key')
      )
    );

    if (hasAuth) {
      return [{ bearerAuth: [] }];
    }

    return undefined;
  }

  exportAsYAML(spec: OpenAPISpec): string {
    // Simple YAML-like output (proper YAML would need a library)
    return JSON.stringify(spec, null, 2)
      .replace(/"/g, '')
      .replace(/,$/gm, '')
      .replace(/^\s*\[$/gm, '')
      .replace(/^\s*\]$/gm, '');
  }

  exportAsJSON(spec: OpenAPISpec): string {
    return JSON.stringify(spec, null, 2);
  }
}
