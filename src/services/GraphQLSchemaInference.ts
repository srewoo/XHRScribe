import { RecordingSession, NetworkRequest } from '@/types';

export interface GraphQLField {
  name: string;
  type: string;
  isNullable: boolean;
  isList: boolean;
  args?: GraphQLArgument[];
  description?: string;
}

export interface GraphQLArgument {
  name: string;
  type: string;
  isRequired: boolean;
  defaultValue?: any;
}

export interface GraphQLType {
  name: string;
  kind: 'OBJECT' | 'INPUT_OBJECT' | 'ENUM' | 'SCALAR' | 'INTERFACE' | 'UNION';
  fields?: GraphQLField[];
  enumValues?: string[];
  description?: string;
}

export interface GraphQLOperation {
  name: string;
  type: 'query' | 'mutation' | 'subscription';
  operationString: string;
  variables?: Record<string, any>;
  response?: any;
  fields: string[];
}

export interface InferredGraphQLSchema {
  types: GraphQLType[];
  queries: GraphQLField[];
  mutations: GraphQLField[];
  subscriptions: GraphQLField[];
  operations: GraphQLOperation[];
  sdl: string;
}

export class GraphQLSchemaInference {
  private static instance: GraphQLSchemaInference;
  private inferredTypes: Map<string, GraphQLType> = new Map();

  private constructor() {}

  static getInstance(): GraphQLSchemaInference {
    if (!GraphQLSchemaInference.instance) {
      GraphQLSchemaInference.instance = new GraphQLSchemaInference();
    }
    return GraphQLSchemaInference.instance;
  }

  inferSchema(session: RecordingSession): InferredGraphQLSchema {
    this.inferredTypes.clear();

    const graphqlRequests = this.extractGraphQLRequests(session.requests);
    const operations: GraphQLOperation[] = [];
    const queries: GraphQLField[] = [];
    const mutations: GraphQLField[] = [];
    const subscriptions: GraphQLField[] = [];

    graphqlRequests.forEach(request => {
      const operation = this.parseGraphQLOperation(request);
      if (operation) {
        operations.push(operation);

        // Infer types from response
        if (request.responseBody) {
          this.inferTypesFromResponse(operation, request.responseBody);
        }

        // Categorize operation
        const field = this.operationToField(operation);
        switch (operation.type) {
          case 'query':
            if (!queries.find(q => q.name === field.name)) {
              queries.push(field);
            }
            break;
          case 'mutation':
            if (!mutations.find(m => m.name === field.name)) {
              mutations.push(field);
            }
            break;
          case 'subscription':
            if (!subscriptions.find(s => s.name === field.name)) {
              subscriptions.push(field);
            }
            break;
        }
      }
    });

    const types = Array.from(this.inferredTypes.values());
    const sdl = this.generateSDL(types, queries, mutations, subscriptions);

    return {
      types,
      queries,
      mutations,
      subscriptions,
      operations,
      sdl
    };
  }

  private extractGraphQLRequests(requests: NetworkRequest[]): NetworkRequest[] {
    return requests.filter(request => {
      // Check URL
      if (request.url.includes('graphql') || request.url.includes('/gql')) {
        return true;
      }

      // Check request body for GraphQL patterns
      if (request.requestBody) {
        const body = typeof request.requestBody === 'string'
          ? request.requestBody
          : JSON.stringify(request.requestBody);

        return body.includes('query') || body.includes('mutation') || body.includes('subscription');
      }

      return false;
    });
  }

  private parseGraphQLOperation(request: NetworkRequest): GraphQLOperation | null {
    try {
      const body = typeof request.requestBody === 'string'
        ? JSON.parse(request.requestBody)
        : request.requestBody;

      if (!body || !body.query) {
        return null;
      }

      const query = body.query as string;
      const operationName = body.operationName || this.extractOperationName(query);
      const variables = body.variables || {};

      // Determine operation type
      const type = this.determineOperationType(query);

      // Extract fields being queried
      const fields = this.extractQueryFields(query);

      return {
        name: operationName,
        type,
        operationString: query,
        variables,
        response: request.responseBody,
        fields
      };
    } catch {
      return null;
    }
  }

  private extractOperationName(query: string): string {
    // Match: query OperationName or mutation OperationName
    const match = query.match(/(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (match) {
      return match[1];
    }

    // Try to extract from first field
    const fieldMatch = query.match(/\{\s*([A-Za-z_][A-Za-z0-9_]*)/);
    if (fieldMatch) {
      return fieldMatch[1];
    }

    return 'UnnamedOperation';
  }

  private determineOperationType(query: string): 'query' | 'mutation' | 'subscription' {
    const trimmed = query.trim().toLowerCase();
    if (trimmed.startsWith('mutation')) return 'mutation';
    if (trimmed.startsWith('subscription')) return 'subscription';
    return 'query';
  }

  private extractQueryFields(query: string): string[] {
    const fields: string[] = [];

    // Simple regex to extract top-level fields
    const fieldMatches = query.match(/\{\s*([A-Za-z_][A-Za-z0-9_]*)/g);
    if (fieldMatches) {
      fieldMatches.forEach(match => {
        const field = match.replace(/[\{\s]/g, '');
        if (field && !fields.includes(field)) {
          fields.push(field);
        }
      });
    }

    return fields;
  }

  private inferTypesFromResponse(operation: GraphQLOperation, response: any): void {
    try {
      const data = typeof response === 'string' ? JSON.parse(response) : response;

      if (data?.data) {
        Object.entries(data.data).forEach(([fieldName, fieldData]) => {
          this.inferTypeFromData(this.pascalCase(fieldName), fieldData);
        });
      }
    } catch {
      // Unable to parse response
    }
  }

  private inferTypeFromData(typeName: string, data: any): GraphQLType {
    if (data === null || data === undefined) {
      return { name: typeName, kind: 'SCALAR', description: 'Unknown type' };
    }

    if (Array.isArray(data)) {
      if (data.length > 0) {
        return this.inferTypeFromData(typeName, data[0]);
      }
      return { name: typeName, kind: 'OBJECT', fields: [] };
    }

    if (typeof data === 'object') {
      const existingType = this.inferredTypes.get(typeName);
      const fields: GraphQLField[] = existingType?.fields || [];

      Object.entries(data).forEach(([key, value]) => {
        const existingField = fields.find(f => f.name === key);
        if (!existingField) {
          fields.push(this.inferField(key, value));
        }
      });

      const type: GraphQLType = {
        name: typeName,
        kind: 'OBJECT',
        fields
      };

      this.inferredTypes.set(typeName, type);
      return type;
    }

    // Scalar types
    return { name: this.inferScalarType(data), kind: 'SCALAR' };
  }

  private inferField(name: string, value: any): GraphQLField {
    const isList = Array.isArray(value);
    const sampleValue = isList && value.length > 0 ? value[0] : value;

    let type: string;
    let isNullable = value === null;

    if (sampleValue === null || sampleValue === undefined) {
      type = 'String';
      isNullable = true;
    } else if (typeof sampleValue === 'object') {
      const typeName = this.pascalCase(name);
      this.inferTypeFromData(typeName, sampleValue);
      type = typeName;
    } else {
      type = this.inferScalarType(sampleValue);
    }

    return {
      name,
      type,
      isNullable,
      isList
    };
  }

  private inferScalarType(value: any): string {
    if (typeof value === 'string') {
      // Check for common patterns
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
        return 'ID';
      }
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        return 'DateTime';
      }
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return 'String'; // Email is typically just String in GraphQL
      }
      return 'String';
    }

    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'Int' : 'Float';
    }

    if (typeof value === 'boolean') {
      return 'Boolean';
    }

    return 'String';
  }

  private operationToField(operation: GraphQLOperation): GraphQLField {
    // Parse arguments from operation string
    const args = this.parseOperationArguments(operation.operationString);

    // Infer return type from response
    let returnType = 'JSON';
    if (operation.response) {
      try {
        const data = typeof operation.response === 'string'
          ? JSON.parse(operation.response)
          : operation.response;

        if (data?.data) {
          const firstKey = Object.keys(data.data)[0];
          if (firstKey) {
            returnType = this.pascalCase(firstKey);
          }
        }
      } catch {
        // Keep default type
      }
    }

    return {
      name: operation.name,
      type: returnType,
      isNullable: true,
      isList: false,
      args
    };
  }

  private parseOperationArguments(query: string): GraphQLArgument[] {
    const args: GraphQLArgument[] = [];

    // Match variable definitions: ($id: ID!, $name: String)
    const varMatch = query.match(/\(([^)]+)\)/);
    if (varMatch) {
      const varString = varMatch[1];
      const varParts = varString.split(',');

      varParts.forEach(part => {
        const match = part.trim().match(/\$([A-Za-z_][A-Za-z0-9_]*):\s*([A-Za-z_][A-Za-z0-9_]*!?)/);
        if (match) {
          const [, name, type] = match;
          args.push({
            name,
            type: type.replace('!', ''),
            isRequired: type.endsWith('!')
          });
        }
      });
    }

    return args;
  }

  private generateSDL(
    types: GraphQLType[],
    queries: GraphQLField[],
    mutations: GraphQLField[],
    subscriptions: GraphQLField[]
  ): string {
    const lines: string[] = [];

    // Add scalar types if needed
    const customScalars = new Set<string>();
    types.forEach(t => {
      if (t.fields) {
        t.fields.forEach(f => {
          if (!['ID', 'String', 'Int', 'Float', 'Boolean'].includes(f.type) && !types.find(type => type.name === f.type)) {
            customScalars.add(f.type);
          }
        });
      }
    });

    if (customScalars.has('DateTime')) {
      lines.push('scalar DateTime');
      lines.push('');
    }
    if (customScalars.has('JSON')) {
      lines.push('scalar JSON');
      lines.push('');
    }

    // Generate type definitions
    types.filter(t => t.kind === 'OBJECT').forEach(type => {
      lines.push(`type ${type.name} {`);
      type.fields?.forEach(field => {
        const fieldType = this.formatFieldType(field);
        lines.push(`  ${field.name}: ${fieldType}`);
      });
      lines.push('}');
      lines.push('');
    });

    // Generate Query type
    if (queries.length > 0) {
      lines.push('type Query {');
      queries.forEach(query => {
        const args = this.formatArguments(query.args);
        const returnType = this.formatFieldType(query);
        lines.push(`  ${query.name}${args}: ${returnType}`);
      });
      lines.push('}');
      lines.push('');
    }

    // Generate Mutation type
    if (mutations.length > 0) {
      lines.push('type Mutation {');
      mutations.forEach(mutation => {
        const args = this.formatArguments(mutation.args);
        const returnType = this.formatFieldType(mutation);
        lines.push(`  ${mutation.name}${args}: ${returnType}`);
      });
      lines.push('}');
      lines.push('');
    }

    // Generate Subscription type
    if (subscriptions.length > 0) {
      lines.push('type Subscription {');
      subscriptions.forEach(sub => {
        const args = this.formatArguments(sub.args);
        const returnType = this.formatFieldType(sub);
        lines.push(`  ${sub.name}${args}: ${returnType}`);
      });
      lines.push('}');
      lines.push('');
    }

    return lines.join('\n');
  }

  private formatFieldType(field: GraphQLField): string {
    let type = field.type;

    if (field.isList) {
      type = `[${type}]`;
    }

    if (!field.isNullable) {
      type = `${type}!`;
    }

    return type;
  }

  private formatArguments(args?: GraphQLArgument[]): string {
    if (!args || args.length === 0) {
      return '';
    }

    const argStrings = args.map(arg => {
      const type = arg.isRequired ? `${arg.type}!` : arg.type;
      return `${arg.name}: ${type}`;
    });

    return `(${argStrings.join(', ')})`;
  }

  private pascalCase(str: string): string {
    return str
      .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
      .replace(/^(.)/, c => c.toUpperCase());
  }

  generateGraphQLTests(schema: InferredGraphQLSchema, framework: string): string {
    const lines: string[] = [];

    // Header
    lines.push('// GraphQL Tests - Generated by XHRScribe');
    lines.push(`// Schema includes ${schema.types.length} types, ${schema.queries.length} queries, ${schema.mutations.length} mutations`);
    lines.push('');

    if (framework === 'jest' || framework === 'vitest') {
      lines.push("const { request, gql } = require('graphql-request');");
    } else if (framework === 'playwright') {
      lines.push("import { test, expect } from '@playwright/test';");
    }

    lines.push('');
    lines.push("const GRAPHQL_ENDPOINT = process.env.GRAPHQL_URL || 'http://localhost:4000/graphql';");
    lines.push('');

    // Query tests
    if (schema.queries.length > 0) {
      lines.push("describe('GraphQL Queries', () => {");
      schema.queries.forEach(query => {
        lines.push(this.generateQueryTest(query, framework));
      });
      lines.push('});');
      lines.push('');
    }

    // Mutation tests
    if (schema.mutations.length > 0) {
      lines.push("describe('GraphQL Mutations', () => {");
      schema.mutations.forEach(mutation => {
        lines.push(this.generateMutationTest(mutation, framework));
      });
      lines.push('});');
    }

    return lines.join('\n');
  }

  private generateQueryTest(query: GraphQLField, framework: string): string {
    const testName = `should execute ${query.name} query`;
    const args = query.args?.map(a => `$${a.name}: ${a.type}${a.isRequired ? '!' : ''}`).join(', ') || '';
    const params = query.args?.map(a => `${a.name}: $${a.name}`).join(', ') || '';

    return `
  test('${testName}', async () => {
    const query = \`
      query ${query.name}${args ? `(${args})` : ''} {
        ${query.name}${params ? `(${params})` : ''} {
          # Add fields here
        }
      }
    \`;

    const variables = {
      ${query.args?.map(a => `${a.name}: /* Add test value */`).join(',\n      ') || ''}
    };

    const response = await request(GRAPHQL_ENDPOINT, query, variables);
    expect(response.${query.name}).toBeDefined();
  });
`;
  }

  private generateMutationTest(mutation: GraphQLField, framework: string): string {
    const testName = `should execute ${mutation.name} mutation`;
    const args = mutation.args?.map(a => `$${a.name}: ${a.type}${a.isRequired ? '!' : ''}`).join(', ') || '';
    const params = mutation.args?.map(a => `${a.name}: $${a.name}`).join(', ') || '';

    return `
  test('${testName}', async () => {
    const mutation = \`
      mutation ${mutation.name}${args ? `(${args})` : ''} {
        ${mutation.name}${params ? `(${params})` : ''} {
          # Add fields here
        }
      }
    \`;

    const variables = {
      ${mutation.args?.map(a => `${a.name}: /* Add test value */`).join(',\n      ') || ''}
    };

    const response = await request(GRAPHQL_ENDPOINT, mutation, variables);
    expect(response.${mutation.name}).toBeDefined();
  });
`;
  }
}
