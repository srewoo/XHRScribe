import { RecordingSession, EndpointDiff, SessionDiffResult } from '@/types';

export class SessionDiffService {
  private static instance: SessionDiffService;

  private constructor() {}

  static getInstance(): SessionDiffService {
    if (!SessionDiffService.instance) {
      SessionDiffService.instance = new SessionDiffService();
    }
    return SessionDiffService.instance;
  }

  diff(sessionA: RecordingSession, sessionB: RecordingSession): SessionDiffResult {
    const endpointsA = this.groupBySignature(sessionA);
    const endpointsB = this.groupBySignature(sessionB);

    const allSignatures = new Set([...endpointsA.keys(), ...endpointsB.keys()]);

    const added: EndpointDiff[] = [];
    const removed: EndpointDiff[] = [];
    const modified: EndpointDiff[] = [];
    const unchanged: EndpointDiff[] = [];

    for (const sig of allSignatures) {
      const a = endpointsA.get(sig);
      const b = endpointsB.get(sig);
      const [method, ...pathParts] = sig.split(' ');
      const path = pathParts.join(' ');

      if (!a && b) {
        added.push({ signature: sig, method, path, status: 'added', countB: b.count });
      } else if (a && !b) {
        removed.push({ signature: sig, method, path, status: 'removed', countA: a.count });
      } else if (a && b) {
        const changes = this.compareEndpoints(a, b);
        if (changes) {
          modified.push({ signature: sig, method, path, status: 'modified', changes, countA: a.count, countB: b.count });
        } else {
          unchanged.push({ signature: sig, method, path, status: 'unchanged', countA: a.count, countB: b.count });
        }
      }
    }

    return {
      sessionA: { id: sessionA.id, name: sessionA.name },
      sessionB: { id: sessionB.id, name: sessionB.name },
      added,
      removed,
      modified,
      unchanged,
      summary: {
        total: allSignatures.size,
        added: added.length,
        removed: removed.length,
        modified: modified.length,
        unchanged: unchanged.length,
      },
    };
  }

  private groupBySignature(session: RecordingSession): Map<string, {
    count: number;
    statuses: number[];
    avgDuration: number;
    responseKeys: string[];
  }> {
    const map = new Map<string, {
      count: number;
      statuses: Set<number>;
      totalDuration: number;
      responseKeys: Set<string>;
    }>();

    for (const req of session.requests) {
      const sig = this.normalizeSignature(req.method, req.url);

      if (!map.has(sig)) {
        map.set(sig, { count: 0, statuses: new Set(), totalDuration: 0, responseKeys: new Set() });
      }
      const entry = map.get(sig)!;
      entry.count++;
      if (req.status) entry.statuses.add(req.status);
      if (req.duration) entry.totalDuration += req.duration;

      // Extract top-level response keys
      if (req.responseBody) {
        try {
          const body = typeof req.responseBody === 'string' ? JSON.parse(req.responseBody) : req.responseBody;
          if (body && typeof body === 'object' && !Array.isArray(body)) {
            for (const key of Object.keys(body)) {
              entry.responseKeys.add(key);
            }
          }
        } catch { /* Not JSON */ }
      }
    }

    const result = new Map<string, { count: number; statuses: number[]; avgDuration: number; responseKeys: string[] }>();
    for (const [sig, entry] of map) {
      result.set(sig, {
        count: entry.count,
        statuses: [...entry.statuses].sort(),
        avgDuration: entry.count > 0 ? Math.round(entry.totalDuration / entry.count) : 0,
        responseKeys: [...entry.responseKeys].sort(),
      });
    }

    return result;
  }

  private normalizeSignature(method: string, url: string): string {
    try {
      const parsed = new URL(url);
      const normalizedPath = parsed.pathname
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{id}')
        .replace(/\/[0-9a-f]{24}/g, '/{id}')
        .replace(/\/\d+/g, '/{id}')
        .replace(/\/+$/, '');
      return `${method} ${normalizedPath}`;
    } catch {
      return `${method} ${url}`;
    }
  }

  private compareEndpoints(
    a: { statuses: number[]; avgDuration: number; responseKeys: string[] },
    b: { statuses: number[]; avgDuration: number; responseKeys: string[] }
  ): EndpointDiff['changes'] | null {
    const changes: EndpointDiff['changes'] = {};
    let hasChanges = false;

    // Status code changes
    const statusA = a.statuses.join(',');
    const statusB = b.statuses.join(',');
    if (statusA !== statusB) {
      changes.statusCodeChanged = { from: a.statuses, to: b.statuses };
      hasChanges = true;
    }

    // Duration changes (>20% difference)
    if (a.avgDuration > 0 && b.avgDuration > 0) {
      const diff = Math.abs(a.avgDuration - b.avgDuration);
      const threshold = Math.max(a.avgDuration, b.avgDuration) * 0.2;
      if (diff > threshold) {
        changes.durationChanged = { from: a.avgDuration, to: b.avgDuration };
        hasChanges = true;
      }
    }

    // Response schema changes
    const keysA = new Set(a.responseKeys);
    const keysB = new Set(b.responseKeys);
    const addedKeys = b.responseKeys.filter(k => !keysA.has(k));
    const removedKeys = a.responseKeys.filter(k => !keysB.has(k));
    if (addedKeys.length > 0 || removedKeys.length > 0) {
      changes.responseSchemaChanged = { addedKeys, removedKeys };
      hasChanges = true;
    }

    return hasChanges ? changes : null;
  }
}
