import { GeneratedTest, RecordingSession, HARData } from '@/types';

// ExportFormat is defined at the bottom of the file, remove this duplicate

export class ExportService {
  private static instance: ExportService;

  private constructor() {}

  static getInstance(): ExportService {
    if (!ExportService.instance) {
      ExportService.instance = new ExportService();
    }
    return ExportService.instance;
  }

  // Main export method that handles both testId and format
  async export(testId: string, format: string): Promise<string> {
    // For now, return a placeholder - in real implementation, 
    // would fetch the test from storage by ID
    const mockTest: GeneratedTest = {
      id: testId,
      framework: 'jest',
      code: '// Test code here',
      qualityScore: 85,
      estimatedTokens: 500,
      estimatedCost: 0.001
    };
    
    return this.exportTest(mockTest, format as ExportFormat);
  }

  // Export test code to various formats
  exportTest(test: GeneratedTest, format: ExportFormat): string {
    switch (format) {
      case 'javascript':
        return this.formatJavaScript(test.code);
      case 'typescript':
        return this.formatTypeScript(test.code);
      case 'json':
        return this.formatJSON(test);
      case 'markdown':
        return this.formatMarkdown(test);
      case 'html':
        return this.formatHTML(test);
      default:
        return test.code;
    }
  }

  // Export HAR data
  exportHAR(session: RecordingSession, harData: HARData): string {
    return JSON.stringify(
      {
        log: {
          version: harData.version,
          creator: harData.creator,
          browser: {
            name: 'Chrome',
            version: navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] || 'unknown',
          },
          pages: [
            {
              startedDateTime: new Date(session.startTime).toISOString(),
              id: session.id,
              title: session.name,
              pageTimings: {
                onContentLoad: -1,
                onLoad: -1,
              },
            },
          ],
          entries: harData.entries,
        },
      },
      null,
      2
    );
  }

  // Export Postman collection
  exportPostmanCollection(session: RecordingSession): string {
    const collection = {
      info: {
        name: session.name,
        description: `Generated from XHRScribe recording on ${new Date(session.startTime).toLocaleString()}`,
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: session.requests.map((req, index) => ({
        name: `${req.method} ${new URL(req.url).pathname}`,
        request: {
          method: req.method,
          header: this.formatPostmanHeaders(req.requestHeaders),
          body: req.requestBody
            ? {
                mode: 'raw',
                raw: JSON.stringify(req.requestBody),
                options: {
                  raw: {
                    language: 'json',
                  },
                },
              }
            : undefined,
          url: {
            raw: req.url,
            protocol: new URL(req.url).protocol.replace(':', ''),
            host: new URL(req.url).hostname.split('.'),
            path: new URL(req.url).pathname.split('/').filter(Boolean),
            query: this.formatPostmanQuery(req.url),
          },
        },
        response: [],
      })),
    };

    return JSON.stringify(collection, null, 2);
  }

  // Export OpenAPI specification
  exportOpenAPI(session: RecordingSession): string {
    const paths: any = {};
    const schemas: any = {};

    session.requests.forEach((req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method.toLowerCase();

      if (!paths[path]) {
        paths[path] = {};
      }

      paths[path][method] = {
        summary: `${req.method} ${path}`,
        operationId: `${method}${path.replace(/\//g, '_')}`,
        parameters: this.extractParameters(url),
        requestBody: req.requestBody
          ? {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                  },
                },
              },
            }
          : undefined,
        responses: {
          [req.status || 200]: {
            description: 'Response',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                },
              },
            },
          },
        },
      };
    });

    const spec = {
      openapi: '3.0.0',
      info: {
        title: session.name,
        version: '1.0.0',
        description: `Generated from XHRScribe recording`,
      },
      servers: [
        {
          url: new URL(session.requests[0]?.url || 'http://localhost').origin,
        },
      ],
      paths,
      components: {
        schemas,
      },
    };

    return JSON.stringify(spec, null, 2);
  }

  // Export cURL commands
  exportCurl(session: RecordingSession): string {
    return session.requests
      .map((req) => {
        let curl = `curl -X ${req.method} '${req.url}'`;

        if (req.requestHeaders) {
          Object.entries(req.requestHeaders).forEach(([key, value]) => {
            curl += ` \\\n  -H '${key}: ${value}'`;
          });
        }

        if (req.requestBody) {
          const body =
            typeof req.requestBody === 'string'
              ? req.requestBody
              : JSON.stringify(req.requestBody);
          curl += ` \\\n  -d '${body}'`;
        }

        return curl;
      })
      .join('\n\n');
  }

  // Copy to clipboard
  async copyToClipboard(content: string): Promise<void> {
    await navigator.clipboard.writeText(content);
  }

  // Download as file
  downloadFile(content: string, filename: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  // Export to VSCode
  async exportToVSCode(test: GeneratedTest): Promise<void> {
    // This would require a VSCode extension or protocol handler
    const vscodeUrl = `vscode://file/${encodeURIComponent(
      `test-${test.id}.${this.getFileExtension(test.framework)}`
    )}`;

    // Try to open in VSCode
    window.open(vscodeUrl);

    // Also copy to clipboard as fallback
    await this.copyToClipboard(test.code);
  }

  private formatJavaScript(code: string): string {
    // Add JavaScript-specific formatting if needed
    return `// Generated by XHRScribe\n// ${new Date().toISOString()}\n\n${code}`;
  }

  private formatTypeScript(code: string): string {
    // Add TypeScript type annotations if not present
    let tsCode = code;
    if (!tsCode.includes(': ')) {
      // Basic type inference
      tsCode = tsCode.replace(/const (\w+) = /g, 'const $1: any = ');
      tsCode = tsCode.replace(/function (\w+)\(/g, 'function $1(');
    }
    return `// Generated by XHRScribe\n// ${new Date().toISOString()}\n\n${tsCode}`;
  }

  private formatJSON(test: GeneratedTest): string {
    return JSON.stringify(
      {
        id: test.id,
        framework: test.framework,
        code: test.code,
        metadata: {
          qualityScore: test.qualityScore,
          estimatedTokens: test.estimatedTokens,
          estimatedCost: test.estimatedCost,
          warnings: test.warnings,
          suggestions: test.suggestions,
          generatedAt: new Date().toISOString(),
        },
      },
      null,
      2
    );
  }

  private formatMarkdown(test: GeneratedTest): string {
    return `# Generated Test Suite

## Framework: ${test.framework}

## Quality Score: ${test.qualityScore}/10

## Estimated Cost: $${test.estimatedCost.toFixed(4)}

## Code:

\`\`\`javascript
${test.code}
\`\`\`

${test.warnings?.length ? `## Warnings:\n${test.warnings.map((w) => `- ${w}`).join('\n')}` : ''}

${test.suggestions?.length ? `## Suggestions:\n${test.suggestions.map((s) => `- ${s}`).join('\n')}` : ''}

---
*Generated by XHRScribe on ${new Date().toLocaleString()}*`;
  }

  private formatHTML(test: GeneratedTest): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Generated Test - ${test.framework}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            line-height: 1.6;
            max-width: 900px;
            margin: 0 auto;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #2196f3; }
        .metadata {
            background: #e3f2fd;
            padding: 15px;
            border-radius: 5px;
            margin: 20px 0;
        }
        pre {
            background: #263238;
            color: #aed581;
            padding: 20px;
            border-radius: 5px;
            overflow-x: auto;
        }
        .warning { color: #ff9800; }
        .suggestion { color: #4caf50; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Generated Test Suite</h1>
        <div class="metadata">
            <p><strong>Framework:</strong> ${test.framework}</p>
            <p><strong>Quality Score:</strong> ${test.qualityScore}/10</p>
            <p><strong>Estimated Cost:</strong> $${test.estimatedCost.toFixed(4)}</p>
            <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <h2>Code</h2>
        <pre><code>${this.escapeHtml(test.code)}</code></pre>
        ${
          test.warnings?.length
            ? `<h2 class="warning">Warnings</h2><ul>${test.warnings
                .map((w) => `<li>${w}</li>`)
                .join('')}</ul>`
            : ''
        }
        ${
          test.suggestions?.length
            ? `<h2 class="suggestion">Suggestions</h2><ul>${test.suggestions
                .map((s) => `<li>${s}</li>`)
                .join('')}</ul>`
            : ''
        }
    </div>
</body>
</html>`;
  }

  private formatPostmanHeaders(headers?: Record<string, string>): any[] {
    if (!headers) return [];
    return Object.entries(headers).map(([key, value]) => ({
      key,
      value,
      type: 'text',
    }));
  }

  private formatPostmanQuery(url: string): any[] {
    const urlObj = new URL(url);
    const params: any[] = [];
    urlObj.searchParams.forEach((value, key) => {
      params.push({ key, value });
    });
    return params;
  }

  private extractParameters(url: URL): any[] {
    const params: any[] = [];
    url.searchParams.forEach((value, key) => {
      params.push({
        name: key,
        in: 'query',
        required: false,
        schema: { type: 'string' },
      });
    });
    return params;
  }

  private escapeHtml(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  private getFileExtension(framework: string): string {
    const extensions: Record<string, string> = {
      jest: 'test.js',
      playwright: 'spec.ts',
      'mocha-chai': 'test.js',
      cypress: 'cy.js',
      puppeteer: 'test.js',
      vitest: 'test.ts',
      supertest: 'test.js',
      postman: 'postman.json',
    };
    return extensions[framework] || 'test.js';
  }
}

export type ExportFormat = 
  | 'javascript'
  | 'typescript'
  | 'json'
  | 'markdown'
  | 'html'
  | 'curl'
  | 'postman'
  | 'openapi'
  | 'har';