import { RecordingSession } from '@/types';
import { Logger } from '@/services/logging/Logger';

export interface FieldSchema {
  type: string;
  children?: Record<string, FieldSchema>;
}

export interface ContractSnapshot {
  signature: string; // e.g. "GET:/api/users"
  schema: Record<string, FieldSchema>;
  capturedAt: number;
  sessionId: string;
}

export interface ContractBreak {
  signature: string;
  type: 'added' | 'removed' | 'type_changed';
  field: string;
  details: string;
}

export class ContractSnapshotService {
  private static instance: ContractSnapshotService;

  private constructor() {}

  static getInstance(): ContractSnapshotService {
    if (!ContractSnapshotService.instance) {
      ContractSnapshotService.instance = new ContractSnapshotService();
    }
    return ContractSnapshotService.instance;
  }

  extractSchema(body: any): Record<string, FieldSchema> {
    if (!body || typeof body !== 'object') return {};

    const schema: Record<string, FieldSchema> = {};

    for (const [key, value] of Object.entries(body)) {
      if (value === null || value === undefined) {
        schema[key] = { type: 'null' };
      } else if (Array.isArray(value)) {
        schema[key] = {
          type: 'array',
          children: value.length > 0 ? this.extractSchema(value[0]) : undefined,
        };
      } else if (typeof value === 'object') {
        schema[key] = {
          type: 'object',
          children: this.extractSchema(value),
        };
      } else {
        schema[key] = { type: typeof value };
      }
    }

    return schema;
  }

  async saveSnapshots(session: RecordingSession): Promise<void> {
    const snapshots: ContractSnapshot[] = [];

    for (const request of session.requests) {
      try {
        const url = new URL(request.url);
        const signature = `${request.method}:${url.pathname}`;

        let body = request.responseBody;
        if (typeof body === 'string') {
          body = JSON.parse(body);
        }

        if (body && typeof body === 'object') {
          // For arrays, extract schema from first element
          const schemaTarget = Array.isArray(body) ? body[0] : body;
          const schema = this.extractSchema(schemaTarget);

          snapshots.push({
            signature,
            schema,
            capturedAt: Date.now(),
            sessionId: session.id,
          });
        }
      } catch {
        // Non-JSON response or parse error — skip
      }
    }

    if (snapshots.length === 0) return;

    // Merge with existing snapshots (keep latest per signature)
    const existing = await this.getStoredSnapshots();
    const merged = new Map<string, ContractSnapshot>();

    for (const snap of existing) {
      merged.set(snap.signature, snap);
    }
    for (const snap of snapshots) {
      merged.set(snap.signature, snap);
    }

    await chrome.storage.local.set({
      '_contract_snapshots': Array.from(merged.values()),
    });

    Logger.getInstance().info(
      `Saved ${snapshots.length} contract snapshots`,
      null,
      'ContractSnapshotService'
    );
  }

  async compareWithStored(session: RecordingSession): Promise<ContractBreak[]> {
    const stored = await this.getStoredSnapshots();
    if (stored.length === 0) return [];

    const storedMap = new Map<string, ContractSnapshot>();
    for (const snap of stored) {
      storedMap.set(snap.signature, snap);
    }

    const breaks: ContractBreak[] = [];

    for (const request of session.requests) {
      try {
        const url = new URL(request.url);
        const signature = `${request.method}:${url.pathname}`;

        const storedSnapshot = storedMap.get(signature);
        if (!storedSnapshot) continue;

        let body = request.responseBody;
        if (typeof body === 'string') body = JSON.parse(body);
        if (!body || typeof body !== 'object') continue;

        const schemaTarget = Array.isArray(body) ? body[0] : body;
        const currentSchema = this.extractSchema(schemaTarget);

        // Diff schemas
        const fieldBreaks = this.diffSchemas(
          storedSnapshot.schema,
          currentSchema,
          signature
        );
        breaks.push(...fieldBreaks);
      } catch {
        // skip
      }
    }

    return breaks;
  }

  private diffSchemas(
    stored: Record<string, FieldSchema>,
    current: Record<string, FieldSchema>,
    signature: string,
    prefix = ''
  ): ContractBreak[] {
    const breaks: ContractBreak[] = [];
    const storedKeys = new Set(Object.keys(stored));
    const currentKeys = new Set(Object.keys(current));

    for (const key of currentKeys) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      if (!storedKeys.has(key)) {
        breaks.push({
          signature,
          type: 'added',
          field: fieldPath,
          details: `New field "${fieldPath}" (${current[key].type})`,
        });
      }
    }

    for (const key of storedKeys) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      if (!currentKeys.has(key)) {
        breaks.push({
          signature,
          type: 'removed',
          field: fieldPath,
          details: `Field "${fieldPath}" removed`,
        });
      } else if (stored[key].type !== current[key].type) {
        breaks.push({
          signature,
          type: 'type_changed',
          field: fieldPath,
          details: `Type changed: ${stored[key].type} → ${current[key].type}`,
        });
      } else if (stored[key].children && current[key].children) {
        breaks.push(
          ...this.diffSchemas(stored[key].children!, current[key].children!, signature, fieldPath)
        );
      }
    }

    return breaks;
  }

  async getStoredSnapshots(): Promise<ContractSnapshot[]> {
    const result = await chrome.storage.local.get('_contract_snapshots');
    return result['_contract_snapshots'] || [];
  }

  async getMaintenanceHints(session: RecordingSession): Promise<{
    newEndpoints: string[];
    changedSchemas: string[];
    removedEndpoints: string[];
  }> {
    const stored = await this.getStoredSnapshots();
    if (stored.length === 0) return { newEndpoints: [], changedSchemas: [], removedEndpoints: [] };

    const storedSignatures = new Set(stored.map(s => s.signature));
    const currentSignatures = new Set<string>();

    for (const request of session.requests) {
      try {
        const url = new URL(request.url);
        currentSignatures.add(`${request.method}:${url.pathname}`);
      } catch {
        // skip
      }
    }

    const newEndpoints = [...currentSignatures].filter(s => !storedSignatures.has(s));
    const removedEndpoints = [...storedSignatures].filter(s => !currentSignatures.has(s));

    const breaks = await this.compareWithStored(session);
    const changedSchemas = [...new Set(breaks.map(b => b.signature))];

    return { newEndpoints, changedSchemas, removedEndpoints };
  }
}
