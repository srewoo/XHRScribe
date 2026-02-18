import { NetworkRequest, EndpointGroup, EndpointCategory } from '@/types';

export class EndpointGrouper {
  private static instance: EndpointGrouper;

  private constructor() {}

  static getInstance(): EndpointGrouper {
    if (!EndpointGrouper.instance) {
      EndpointGrouper.instance = new EndpointGrouper();
    }
    return EndpointGrouper.instance;
  }

  groupEndpoints(requests: NetworkRequest[]): EndpointGroup[] {
    // Normalize and group by resource path
    const resourceMap = new Map<string, {
      methods: Set<string>;
      requests: Array<{ method: string; path: string; status?: number }>;
    }>();

    for (const req of requests) {
      try {
        const url = new URL(req.url);
        const normalized = this.normalizePath(url.pathname);

        if (!resourceMap.has(normalized)) {
          resourceMap.set(normalized, { methods: new Set(), requests: [] });
        }
        const entry = resourceMap.get(normalized)!;
        entry.methods.add(req.method);
        entry.requests.push({ method: req.method, path: url.pathname, status: req.status });
      } catch {
        // Skip invalid URLs
      }
    }

    // Build groups
    const groups: EndpointGroup[] = [];

    for (const [normalizedPath, data] of resourceMap) {
      const methods = [...data.methods];
      const category = this.detectCategory(normalizedPath, methods, requests);
      const isCrud = this.isCrudPattern(methods);

      // Build endpoint breakdown
      const endpointBreakdown = new Map<string, { count: number; statuses: Set<number> }>();
      for (const r of data.requests) {
        const key = `${r.method} ${r.path}`;
        if (!endpointBreakdown.has(key)) {
          endpointBreakdown.set(key, { count: 0, statuses: new Set() });
        }
        const eb = endpointBreakdown.get(key)!;
        eb.count++;
        if (r.status) eb.statuses.add(r.status);
      }

      // Extract resource name from path
      const resource = this.extractResourceName(normalizedPath);

      groups.push({
        resource,
        category,
        normalizedPath,
        methods,
        isCrud,
        requestCount: data.requests.length,
        endpoints: [...endpointBreakdown.entries()].map(([key, val]) => {
          const [method, ...pathParts] = key.split(' ');
          return {
            method,
            path: pathParts.join(' '),
            count: val.count,
            statuses: [...val.statuses],
          };
        }),
      });
    }

    // Sort: CRUD first, then by request count descending
    return groups.sort((a, b) => {
      if (a.isCrud !== b.isCrud) return a.isCrud ? -1 : 1;
      return b.requestCount - a.requestCount;
    });
  }

  private normalizePath(pathname: string): string {
    return pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}') // UUID
      .replace(/\/[0-9a-f]{24}/g, '/{id}') // ObjectId
      .replace(/\/\d+/g, '/{id}') // Numeric IDs
      .replace(/\/{id}\/{id}/g, '/{id}') // Collapse double IDs
      .replace(/\/+$/, ''); // Trailing slashes
  }

  private extractResourceName(normalizedPath: string): string {
    const segments = normalizedPath.split('/').filter(Boolean);
    // Find last non-{id} segment
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i] !== '{id}') {
        return segments[i];
      }
    }
    return normalizedPath || '/';
  }

  private isCrudPattern(methods: string[]): boolean {
    const crudMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    const matchCount = methods.filter(m => crudMethods.includes(m)).length;
    return matchCount >= 2;
  }

  private detectCategory(path: string, methods: string[], requests: NetworkRequest[]): EndpointCategory {
    const lower = path.toLowerCase();

    // Auth patterns
    if (/\/(auth|login|logout|signup|register|token|oauth|sso|session|password|verify)/.test(lower)) {
      return 'Auth';
    }

    // Health patterns
    if (/\/(health|healthz|ready|readyz|ping|status|alive|heartbeat)/.test(lower)) {
      return 'Health';
    }

    // Admin patterns
    if (/\/(admin|dashboard|management|internal|backoffice|settings|config)/.test(lower)) {
      return 'Admin';
    }

    // Search patterns
    if (/\/(search|find|query|filter|lookup|autocomplete|suggest)/.test(lower)) {
      return 'Search';
    }

    // Upload patterns
    if (/\/(upload|import|file|attachment|media|image|document)/.test(lower)) {
      return 'Upload';
    }

    // Webhook patterns
    if (/\/(webhook|hook|callback|notify|event)/.test(lower)) {
      return 'Webhook';
    }

    // Streaming patterns
    if (/\/(stream|feed|live|sse|events|subscribe)/.test(lower)) {
      return 'Streaming';
    }

    // GraphQL
    if (/\/(graphql|gql)/.test(lower)) {
      return 'GraphQL';
    }

    // CRUD detection
    if (this.isCrudPattern(methods)) {
      return 'CRUD';
    }

    return 'Other';
  }
}
