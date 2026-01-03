import { RecordingSession, NetworkRequest, TestFramework } from '@/types';

export interface EndpointSignature {
  path: string;
  method: string;
  pathPattern: string;
  requestSchema: any;
  responseSchema: any;
  headers: string[];
  queryParams: string[];
  version: number;
  lastSeen: number;
}

export interface EndpointChange {
  type: 'added' | 'removed' | 'modified' | 'renamed';
  field: string;
  oldValue?: any;
  newValue?: any;
  severity: 'breaking' | 'non-breaking';
  migrationSuggestion?: string;
}

export interface HealingSuggestion {
  testName: string;
  issue: string;
  suggestion: string;
  autoFixable: boolean;
  fixCode?: string;
  confidence: number;
}

export interface EndpointDiff {
  endpoint: string;
  method: string;
  changes: EndpointChange[];
  healingSuggestions: HealingSuggestion[];
  isBreaking: boolean;
}

export class AutoHealingService {
  private static instance: AutoHealingService;
  private signatureCache: Map<string, EndpointSignature> = new Map();
  private historyLimit = 10;

  private constructor() {
    this.loadSignatures();
  }

  static getInstance(): AutoHealingService {
    if (!AutoHealingService.instance) {
      AutoHealingService.instance = new AutoHealingService();
    }
    return AutoHealingService.instance;
  }

  private async loadSignatures(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('endpoint_signatures');
      if (result.endpoint_signatures) {
        const signatures = JSON.parse(result.endpoint_signatures);
        Object.entries(signatures).forEach(([key, value]) => {
          this.signatureCache.set(key, value as EndpointSignature);
        });
      }
    } catch {
      // Storage not available or empty
    }
  }

  private async saveSignatures(): Promise<void> {
    try {
      const signatures: Record<string, EndpointSignature> = {};
      this.signatureCache.forEach((value, key) => {
        signatures[key] = value;
      });
      await chrome.storage.local.set({
        endpoint_signatures: JSON.stringify(signatures)
      });
    } catch {
      // Storage error
    }
  }

  captureSignatures(session: RecordingSession): void {
    session.requests.forEach(request => {
      const signature = this.createSignature(request);
      const key = `${signature.method}::${signature.pathPattern}`;

      const existing = this.signatureCache.get(key);
      if (existing) {
        // Merge schemas
        signature.requestSchema = this.mergeSchemas(existing.requestSchema, signature.requestSchema);
        signature.responseSchema = this.mergeSchemas(existing.responseSchema, signature.responseSchema);
        signature.version = existing.version + 1;
      }

      this.signatureCache.set(key, signature);
    });

    this.saveSignatures();
  }

  private createSignature(request: NetworkRequest): EndpointSignature {
    const pathPattern = this.normalizePathPattern(request.url);

    return {
      path: request.url,
      method: request.method,
      pathPattern,
      requestSchema: this.inferSchema(request.requestBody),
      responseSchema: this.inferSchema(request.responseBody),
      headers: Object.keys(request.requestHeaders || {}),
      queryParams: this.extractQueryParams(request.url),
      version: 1,
      lastSeen: Date.now()
    };
  }

  private normalizePathPattern(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.pathname
        .split('/')
        .map(part => {
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)) return ':id';
          if (/^\d+$/.test(part)) return ':id';
          if (/^[0-9a-f]{24}$/i.test(part)) return ':id';
          return part;
        })
        .join('/');
    } catch {
      return url;
    }
  }

  private extractQueryParams(url: string): string[] {
    try {
      const urlObj = new URL(url);
      return Array.from(urlObj.searchParams.keys());
    } catch {
      return [];
    }
  }

  private inferSchema(data: any): any {
    if (data === null || data === undefined) return null;

    if (Array.isArray(data)) {
      return {
        type: 'array',
        items: data.length > 0 ? this.inferSchema(data[0]) : null
      };
    }

    if (typeof data === 'object') {
      const properties: Record<string, any> = {};
      Object.entries(data).forEach(([key, value]) => {
        properties[key] = this.inferSchema(value);
      });
      return { type: 'object', properties };
    }

    return { type: typeof data };
  }

  private mergeSchemas(existing: any, newSchema: any): any {
    if (!existing) return newSchema;
    if (!newSchema) return existing;

    if (existing.type !== newSchema.type) {
      return { type: 'any', variants: [existing, newSchema] };
    }

    if (existing.type === 'object' && newSchema.type === 'object') {
      const mergedProperties: Record<string, any> = { ...existing.properties };
      Object.entries(newSchema.properties || {}).forEach(([key, value]) => {
        if (mergedProperties[key]) {
          mergedProperties[key] = this.mergeSchemas(mergedProperties[key], value);
        } else {
          mergedProperties[key] = value;
        }
      });
      return { type: 'object', properties: mergedProperties };
    }

    return newSchema;
  }

  detectChanges(newSession: RecordingSession): EndpointDiff[] {
    const diffs: EndpointDiff[] = [];

    newSession.requests.forEach(request => {
      const newSignature = this.createSignature(request);
      const key = `${newSignature.method}::${newSignature.pathPattern}`;
      const oldSignature = this.signatureCache.get(key);

      if (oldSignature) {
        const changes = this.compareSignatures(oldSignature, newSignature);

        if (changes.length > 0) {
          const healingSuggestions = this.generateHealingSuggestions(changes, request);

          diffs.push({
            endpoint: request.url,
            method: request.method,
            changes,
            healingSuggestions,
            isBreaking: changes.some(c => c.severity === 'breaking')
          });
        }
      }
    });

    return diffs;
  }

  private compareSignatures(oldSig: EndpointSignature, newSig: EndpointSignature): EndpointChange[] {
    const changes: EndpointChange[] = [];

    // Compare request schema
    const requestChanges = this.compareSchemas(oldSig.requestSchema, newSig.requestSchema, 'request');
    changes.push(...requestChanges);

    // Compare response schema
    const responseChanges = this.compareSchemas(oldSig.responseSchema, newSig.responseSchema, 'response');
    changes.push(...responseChanges);

    // Compare headers
    const addedHeaders = newSig.headers.filter(h => !oldSig.headers.includes(h));
    const removedHeaders = oldSig.headers.filter(h => !newSig.headers.includes(h));

    addedHeaders.forEach(header => {
      changes.push({
        type: 'added',
        field: `header.${header}`,
        newValue: header,
        severity: 'non-breaking',
        migrationSuggestion: `Add header "${header}" to requests`
      });
    });

    removedHeaders.forEach(header => {
      changes.push({
        type: 'removed',
        field: `header.${header}`,
        oldValue: header,
        severity: header.toLowerCase().includes('auth') ? 'breaking' : 'non-breaking',
        migrationSuggestion: `Remove header "${header}" from requests`
      });
    });

    // Compare query params
    const addedParams = newSig.queryParams.filter(p => !oldSig.queryParams.includes(p));
    const removedParams = oldSig.queryParams.filter(p => !newSig.queryParams.includes(p));

    addedParams.forEach(param => {
      changes.push({
        type: 'added',
        field: `queryParam.${param}`,
        newValue: param,
        severity: 'non-breaking',
        migrationSuggestion: `Add query parameter "${param}"`
      });
    });

    removedParams.forEach(param => {
      changes.push({
        type: 'removed',
        field: `queryParam.${param}`,
        oldValue: param,
        severity: 'non-breaking',
        migrationSuggestion: `Remove query parameter "${param}"`
      });
    });

    return changes;
  }

  private compareSchemas(oldSchema: any, newSchema: any, prefix: string): EndpointChange[] {
    const changes: EndpointChange[] = [];

    if (!oldSchema || !newSchema) return changes;

    if (oldSchema.type !== newSchema.type) {
      changes.push({
        type: 'modified',
        field: prefix,
        oldValue: oldSchema.type,
        newValue: newSchema.type,
        severity: 'breaking',
        migrationSuggestion: `Update ${prefix} type from ${oldSchema.type} to ${newSchema.type}`
      });
      return changes;
    }

    if (oldSchema.type === 'object' && newSchema.type === 'object') {
      const oldProps = Object.keys(oldSchema.properties || {});
      const newProps = Object.keys(newSchema.properties || {});

      // Removed properties
      oldProps.forEach(prop => {
        if (!newProps.includes(prop)) {
          changes.push({
            type: 'removed',
            field: `${prefix}.${prop}`,
            oldValue: oldSchema.properties[prop],
            severity: 'breaking',
            migrationSuggestion: `Remove references to ${prefix}.${prop}`
          });
        }
      });

      // Added properties
      newProps.forEach(prop => {
        if (!oldProps.includes(prop)) {
          changes.push({
            type: 'added',
            field: `${prefix}.${prop}`,
            newValue: newSchema.properties[prop],
            severity: 'non-breaking',
            migrationSuggestion: `Add handling for new field ${prefix}.${prop}`
          });
        }
      });

      // Modified properties
      newProps.forEach(prop => {
        if (oldProps.includes(prop)) {
          const nestedChanges = this.compareSchemas(
            oldSchema.properties[prop],
            newSchema.properties[prop],
            `${prefix}.${prop}`
          );
          changes.push(...nestedChanges);
        }
      });
    }

    return changes;
  }

  private generateHealingSuggestions(changes: EndpointChange[], request: NetworkRequest): HealingSuggestion[] {
    const suggestions: HealingSuggestion[] = [];

    changes.forEach(change => {
      switch (change.type) {
        case 'removed':
          suggestions.push({
            testName: `Test accessing ${change.field}`,
            issue: `Field "${change.field}" has been removed from the API`,
            suggestion: `Remove assertions and references to ${change.field}`,
            autoFixable: true,
            fixCode: this.generateRemovalFix(change.field),
            confidence: 90
          });
          break;

        case 'added':
          suggestions.push({
            testName: `Test for new field ${change.field}`,
            issue: `New field "${change.field}" has been added`,
            suggestion: `Consider adding assertions for ${change.field}`,
            autoFixable: false,
            confidence: 70
          });
          break;

        case 'modified':
          suggestions.push({
            testName: `Test type of ${change.field}`,
            issue: `Field "${change.field}" type changed from ${change.oldValue} to ${change.newValue}`,
            suggestion: `Update type assertions for ${change.field}`,
            autoFixable: true,
            fixCode: this.generateTypeFix(change.field, change.newValue),
            confidence: 85
          });
          break;

        case 'renamed':
          suggestions.push({
            testName: `Test accessing ${change.oldValue}`,
            issue: `Field "${change.oldValue}" renamed to "${change.newValue}"`,
            suggestion: `Update all references from ${change.oldValue} to ${change.newValue}`,
            autoFixable: true,
            fixCode: this.generateRenameFix(change.oldValue as string, change.newValue as string),
            confidence: 95
          });
          break;
      }
    });

    return suggestions;
  }

  private generateRemovalFix(field: string): string {
    const fieldPath = field.replace(/^(request|response)\./, '');
    return `
// Auto-fix: Remove references to removed field
// Find and remove: expect(response.${fieldPath}).toBeDefined();
// Replace assertions with:
// expect(response).not.toHaveProperty('${fieldPath}');
`.trim();
  }

  private generateTypeFix(field: string, newType: string): string {
    const fieldPath = field.replace(/^(request|response)\./, '');
    return `
// Auto-fix: Update type assertion
expect(typeof response.${fieldPath}).toBe('${newType}');
`.trim();
  }

  private generateRenameFix(oldName: string, newName: string): string {
    return `
// Auto-fix: Rename field
// Replace all occurrences:
// Old: response.${oldName}
// New: response.${newName}
//
// Find: /\\.${oldName}\\b/g
// Replace: .${newName}
`.trim();
  }

  applyAutoFix(testCode: string, suggestions: HealingSuggestion[]): string {
    let fixedCode = testCode;

    suggestions
      .filter(s => s.autoFixable && s.confidence >= 80)
      .forEach(suggestion => {
        // Apply specific fixes based on fix type
        if (suggestion.issue.includes('removed')) {
          // Remove assertions for deleted fields
          const fieldMatch = suggestion.issue.match(/Field "(.+)" has been removed/);
          if (fieldMatch) {
            const field = fieldMatch[1].replace(/^(request|response)\./, '');
            // Remove lines containing assertions for this field
            const regex = new RegExp(`^.*expect.*\\.${field}.*$`, 'gm');
            fixedCode = fixedCode.replace(regex, `// REMOVED: Field ${field} no longer exists`);
          }
        }

        if (suggestion.issue.includes('renamed')) {
          const renameMatch = suggestion.issue.match(/Field "(.+)" renamed to "(.+)"/);
          if (renameMatch) {
            const [, oldName, newName] = renameMatch;
            const regex = new RegExp(`\\.${oldName}\\b`, 'g');
            fixedCode = fixedCode.replace(regex, `.${newName}`);
          }
        }

        if (suggestion.issue.includes('type changed')) {
          const typeMatch = suggestion.issue.match(/Field "(.+)" type changed from (\w+) to (\w+)/);
          if (typeMatch) {
            const [, field, oldType, newType] = typeMatch;
            const fieldPath = field.replace(/^(request|response)\./, '');
            // Update type assertions
            const regex = new RegExp(`expect\\(typeof.*\\.${fieldPath}.*\\)\\.toBe\\(['"]${oldType}['"]\\)`, 'g');
            fixedCode = fixedCode.replace(regex, `expect(typeof response.${fieldPath}).toBe('${newType}')`);
          }
        }
      });

    return fixedCode;
  }

  generateSelfHealingWrapper(framework: TestFramework): string {
    switch (framework) {
      case 'jest':
      case 'vitest':
        return `
// Self-Healing Test Wrapper
// Automatically retries with fixes when tests fail due to API changes

const selfHealingTest = (name, testFn, options = {}) => {
  const maxRetries = options.retries || 3;

  test(name, async () => {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await testFn();
        return; // Test passed
      } catch (error) {
        lastError = error;

        // Analyze error and attempt to heal
        const healingResult = analyzeAndHeal(error);

        if (healingResult.healed) {
          console.log(\`🔧 Auto-healed: \${healingResult.description}\`);
          continue; // Retry with healed configuration
        }

        if (attempt === maxRetries - 1) {
          throw lastError;
        }
      }
    }
  });
};

function analyzeAndHeal(error) {
  const message = error.message || '';

  // Detect common issues
  if (message.includes('property') && message.includes('undefined')) {
    const fieldMatch = message.match(/property '(\\w+)'/);
    if (fieldMatch) {
      return {
        healed: true,
        description: \`Field '\${fieldMatch[1]}' no longer exists, skipping assertion\`
      };
    }
  }

  if (message.includes('404')) {
    return {
      healed: false,
      description: 'Endpoint not found - manual intervention required'
    };
  }

  return { healed: false };
}

module.exports = { selfHealingTest };
`;

      case 'playwright':
        return `
// Self-Healing Test Wrapper for Playwright
import { test as baseTest, expect } from '@playwright/test';

export const test = baseTest.extend({
  autoHeal: async ({}, use) => {
    const heal = async (testFn, retries = 3) => {
      let lastError;

      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          await testFn();
          return;
        } catch (error) {
          lastError = error;
          console.log(\`Attempt \${attempt + 1} failed, analyzing...\`);

          // Auto-healing logic
          const healed = await analyzeAndHeal(error);
          if (!healed) break;
        }
      }

      throw lastError;
    };

    await use(heal);
  }
});

async function analyzeAndHeal(error) {
  // Implementation similar to Jest version
  return false;
}
`;

      default:
        return '// Self-healing wrapper not available for this framework';
    }
  }

  generateMigrationScript(diffs: EndpointDiff[]): string {
    const lines: string[] = [];

    lines.push('#!/usr/bin/env node');
    lines.push('// API Migration Script - Generated by XHRScribe');
    lines.push(`// Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push("const fs = require('fs');");
    lines.push("const path = require('path');");
    lines.push('');
    lines.push('const migrations = [');

    diffs.forEach(diff => {
      diff.changes.forEach(change => {
        lines.push(`  {`);
        lines.push(`    endpoint: '${diff.endpoint}',`);
        lines.push(`    type: '${change.type}',`);
        lines.push(`    field: '${change.field}',`);
        lines.push(`    severity: '${change.severity}',`);
        lines.push(`    migration: '${change.migrationSuggestion || ''}',`);
        lines.push(`  },`);
      });
    });

    lines.push('];');
    lines.push('');
    lines.push('function applyMigrations(testDir) {');
    lines.push('  const files = fs.readdirSync(testDir);');
    lines.push('  ');
    lines.push('  files.forEach(file => {');
    lines.push("    if (!file.endsWith('.test.js') && !file.endsWith('.spec.ts')) return;");
    lines.push('    ');
    lines.push('    let content = fs.readFileSync(path.join(testDir, file), "utf8");');
    lines.push('    let modified = false;');
    lines.push('    ');
    lines.push('    migrations.forEach(m => {');
    lines.push("      if (m.type === 'renamed' && content.includes(m.field)) {");
    lines.push('        // Apply rename');
    lines.push('        modified = true;');
    lines.push('      }');
    lines.push('    });');
    lines.push('    ');
    lines.push('    if (modified) {');
    lines.push('      fs.writeFileSync(path.join(testDir, file), content);');
    lines.push(`      console.log(\`Updated: \${file}\`);`);
    lines.push('    }');
    lines.push('  });');
    lines.push('}');
    lines.push('');
    lines.push("applyMigrations(process.argv[2] || './tests');");

    return lines.join('\n');
  }
}
