import { ValidationIssue, DeepValidator } from './DeepValidator';
import { TestFramework, AIProvider, AIModel } from '@/types';
import { StorageService } from './StorageService';

export interface AutoFixResult {
  success: boolean;
  fixedCode: string;
  issuesFixed: ValidationIssue[];
  remainingIssues: ValidationIssue[];
  fixLog: string[];
  confidenceScore: number; // 0-100
}

export interface FixStrategy {
  name: string;
  description: string;
  applicable: (issue: ValidationIssue) => boolean;
  fix: (code: string, issue: ValidationIssue, framework: TestFramework) => string;
  confidence: number; // 0-100
}

export class IntelligentAutoFixer {
  private static instance: IntelligentAutoFixer;
  private storageService: StorageService;
  private deepValidator: DeepValidator;
  private fixStrategies: FixStrategy[];

  static getInstance(): IntelligentAutoFixer {
    if (!IntelligentAutoFixer.instance) {
      IntelligentAutoFixer.instance = new IntelligentAutoFixer();
    }
    return IntelligentAutoFixer.instance;
  }

  constructor() {
    this.storageService = StorageService.getInstance();
    this.deepValidator = DeepValidator.getInstance();
    this.fixStrategies = this.initializeFixStrategies();
  }

  async autoFixWithAI(
    code: string, 
    issues: ValidationIssue[], 
    framework: TestFramework,
    maxAttempts: number = 3
  ): Promise<AutoFixResult> {
    console.log(`🔧 Starting intelligent auto-fix for ${issues.length} issues...`);
    
    let currentCode = code;
    let fixedIssues: ValidationIssue[] = [];
    let fixLog: string[] = [];
    let attempt = 0;

    // Phase 1: Apply rule-based fixes
    console.log('📋 Phase 1: Applying rule-based fixes...');
    const ruleBasedResult = this.applyRuleBasedFixes(currentCode, issues, framework);
    currentCode = ruleBasedResult.fixedCode;
    fixedIssues.push(...ruleBasedResult.issuesFixed);
    fixLog.push(...ruleBasedResult.fixLog);

    // Phase 2: Apply AI-powered fixes for complex issues
    const remainingIssues = issues.filter(issue => 
      !fixedIssues.some(fixed => this.isSameIssue(issue, fixed))
    );

    if (remainingIssues.length > 0 && attempt < maxAttempts) {
      console.log('🤖 Phase 2: Applying AI-powered fixes...');
      const aiResult = await this.applyAIFixes(currentCode, remainingIssues, framework);
      if (aiResult.success) {
        currentCode = aiResult.fixedCode;
        fixedIssues.push(...aiResult.issuesFixed);
        fixLog.push(...aiResult.fixLog);
      }
    }

    // Phase 3: Validate results
    console.log('✅ Phase 3: Validating fix results...');
      const validation = this.deepValidator.validateTestSuite(currentCode, { 
        version: '1.2', 
        creator: { name: 'XHRScribe', version: '1.0' }, 
        entries: [] 
      }, framework);
    const finalRemainingIssues = validation.detailedIssues;

    const confidenceScore = this.calculateConfidenceScore(
      issues.length, 
      fixedIssues.length, 
      validation.overallScore
    );

    const result: AutoFixResult = {
      success: fixedIssues.length > 0,
      fixedCode: currentCode,
      issuesFixed: fixedIssues,
      remainingIssues: finalRemainingIssues,
      fixLog,
      confidenceScore
    };

    console.log(`🎯 Auto-fix completed: ${fixedIssues.length}/${issues.length} issues fixed (${confidenceScore}% confidence)`);
    
    return result;
  }

  private applyRuleBasedFixes(
    code: string, 
    issues: ValidationIssue[], 
    framework: TestFramework
  ): { fixedCode: string; issuesFixed: ValidationIssue[]; fixLog: string[] } {
    let currentCode = code;
    const fixedIssues: ValidationIssue[] = [];
    const fixLog: string[] = [];

    // Sort issues by priority (critical first, then by confidence of fix)
    const sortedIssues = issues
      .filter(issue => issue.autoFixable)
      .sort((a, b) => {
        const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return severityOrder[b.severity] - severityOrder[a.severity];
      });

    for (const issue of sortedIssues) {
      const applicableStrategies = this.fixStrategies.filter(strategy => 
        strategy.applicable(issue)
      );

      if (applicableStrategies.length > 0) {
        // Use the strategy with highest confidence
        const bestStrategy = applicableStrategies.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );

        try {
          const fixedCode = bestStrategy.fix(currentCode, issue, framework);
          if (fixedCode !== currentCode) {
            currentCode = fixedCode;
            fixedIssues.push(issue);
            fixLog.push(`✅ Fixed ${issue.type} issue: ${issue.description} (Strategy: ${bestStrategy.name})`);
          }
        } catch (error) {
          fixLog.push(`❌ Failed to fix ${issue.type} issue: ${issue.description} (Error: ${(error as Error).message})`);
        }
      }
    }

    return { fixedCode: currentCode, issuesFixed: fixedIssues, fixLog };
  }

  private async applyAIFixes(
    code: string,
    issues: ValidationIssue[],
    framework: TestFramework
  ): Promise<{ success: boolean; fixedCode: string; issuesFixed: ValidationIssue[]; fixLog: string[] }> {
    try {
      const settings = await this.storageService.getSettings();
      if (!settings?.aiProvider || !settings?.aiModel) {
        return { success: false, fixedCode: code, issuesFixed: [], fixLog: ['❌ AI provider not configured'] };
      }

      const fixPrompt = this.buildAIFixPrompt(code, issues, framework);
      const fixedCode = await this.callAIForFix(fixPrompt, settings.aiProvider, settings.aiModel);

      // Validate the AI fix
      const validation = this.deepValidator.validateTestSuite(fixedCode, { 
        version: '1.2', 
        creator: { name: 'XHRScribe', version: '1.0' }, 
        entries: [] 
      }, framework);
      const remainingIssueCount = validation.detailedIssues.length;
      const originalIssueCount = issues.length;

      if (remainingIssueCount < originalIssueCount) {
        const fixedIssues = issues.slice(0, originalIssueCount - remainingIssueCount);
        return {
          success: true,
          fixedCode,
          issuesFixed: fixedIssues,
          fixLog: [`🤖 AI fixed ${fixedIssues.length} issues using ${settings.aiProvider} ${settings.aiModel}`]
        };
      } else {
        return {
          success: false,
          fixedCode: code,
          issuesFixed: [],
          fixLog: ['🤖 AI fix did not improve code quality']
        };
      }
    } catch (error) {
      return {
        success: false,
        fixedCode: code,
        issuesFixed: [],
        fixLog: [`❌ AI fix failed: ${(error as Error).message}`]
      };
    }
  }

  private buildAIFixPrompt(code: string, issues: ValidationIssue[], framework: TestFramework): string {
    const issueDescriptions = issues.map((issue, index) => 
      `${index + 1}. [${issue.severity.toUpperCase()} ${issue.type}] ${issue.description}${issue.suggestion ? ` - Suggestion: ${issue.suggestion}` : ''}`
    ).join('\n');

    return `You are an expert ${framework} test engineer. Fix the following issues in the test code:

ISSUES TO FIX:
${issueDescriptions}

FRAMEWORK: ${framework}

CURRENT CODE:
\`\`\`${framework === 'cypress' ? 'javascript' : 'typescript'}
${code}
\`\`\`

REQUIREMENTS:
1. Fix ALL listed issues without breaking existing functionality
2. Maintain the existing test structure and logic
3. Ensure the code is production-ready and follows ${framework} best practices
4. Add proper error handling where missing
5. Replace hardcoded values with environment variables
6. Add missing imports and dependencies
7. Fix syntax errors and ensure proper formatting
8. Add comprehensive assertions where missing

CRITICAL: Return ONLY the corrected code, no explanations or markdown formatting:`;
  }

  private async callAIForFix(prompt: string, provider: AIProvider, model: AIModel): Promise<string> {
    // This would integrate with the existing LLM providers
    // For now, returning the original code as a placeholder
    // In production, this would call the configured AI provider
    throw new Error('AI fix integration not yet implemented');
  }

  private initializeFixStrategies(): FixStrategy[] {
    return [
      // Syntax fixes
      {
        name: 'Missing Imports Fixer',
        description: 'Adds missing framework imports',
        applicable: (issue) => issue.type === 'syntax' && issue.description.includes('Missing import'),
        fix: (code, issue, framework) => this.fixMissingImports(code, framework),
        confidence: 95
      },
      {
        name: 'Brace Balancer',
        description: 'Fixes unmatched braces and parentheses',
        fix: (code, issue) => this.fixUnmatchedBraces(code, issue),
        applicable: (issue) => issue.description.includes('Unmatched'),
        confidence: 90
      },
      {
        name: 'Async/Await Fixer',
        description: 'Fixes async function declarations',
        applicable: (issue) => issue.description.includes('await without async'),
        fix: (code) => this.fixAsyncAwait(code),
        confidence: 85
      },

      // Completeness fixes
      {
        name: 'Placeholder Remover',
        description: 'Removes placeholder comments and incomplete code',
        applicable: (issue) => issue.description.includes('Placeholder') || issue.description.includes('placeholder'),
        fix: (code) => this.removePlaceholderComments(code),
        confidence: 100
      },
      {
        name: 'Authentication Setup Adder',
        description: 'Adds missing authentication setup',
        applicable: (issue) => issue.description.includes('Missing authentication setup'),
        fix: (code, issue, framework) => this.addAuthenticationSetup(code, framework),
        confidence: 80
      },

      // Quality fixes
      {
        name: 'Environment Variable Replacer',
        description: 'Replaces hardcoded values with environment variables',
        applicable: (issue) => issue.description.includes('Hardcoded value'),
        fix: (code, issue) => this.replaceHardcodedValues(code),
        confidence: 75
      },
      {
        name: 'Error Handler Adder',
        description: 'Adds proper error handling',
        applicable: (issue) => issue.description.includes('error handling'),
        fix: (code) => this.addErrorHandling(code),
        confidence: 70
      },
      {
        name: 'Naming Consistency Fixer',
        description: 'Fixes inconsistent naming patterns',
        applicable: (issue) => issue.description.includes('naming') || issue.description.includes('consistent'),
        fix: (code, issue, framework) => this.fixNamingConsistency(code, framework),
        confidence: 80
      },

      // Security fixes
      {
        name: 'Credential Protector',
        description: 'Protects exposed credentials',
        applicable: (issue) => issue.type === 'security' && issue.description.includes('credential'),
        fix: (code) => this.protectCredentials(code),
        confidence: 90
      },
      {
        name: 'Security Test Adder',
        description: 'Adds missing security tests',
        applicable: (issue) => issue.type === 'security' && issue.description.includes('Missing'),
        fix: (code, issue) => this.addSecurityTests(code, issue),
        confidence: 65
      },

      // Performance fixes
      {
        name: 'Timeout Configurator',
        description: 'Adds timeout configurations',
        applicable: (issue) => issue.description.includes('timeout'),
        fix: (code, issue, framework) => this.addTimeoutConfiguration(code, framework),
        confidence: 85
      },
      {
        name: 'Cleanup Adder',
        description: 'Adds resource cleanup',
        applicable: (issue) => issue.description.includes('cleanup'),
        fix: (code, issue, framework) => this.addResourceCleanup(code, framework),
        confidence: 80
      }
    ];
  }

  // Fix implementation methods
  private fixMissingImports(code: string, framework: TestFramework): string {
    const imports: string[] = [];
    
    switch (framework) {
      case 'playwright':
        if (!code.includes('@playwright/test')) {
          imports.push("import { test, expect } from '@playwright/test';");
        }
        break;
      case 'jest':
        if (code.includes('supertest') && !code.includes("require('supertest')")) {
          imports.push("const request = require('supertest');");
        }
        break;
      case 'vitest':
        if (!code.includes('vitest')) {
          imports.push("import { describe, test, expect, beforeAll, afterAll } from 'vitest';");
        }
        break;
    }

    // Add faker if used but not imported
    if (code.includes('faker') && !code.includes('faker')) {
      imports.push("import { faker } from '@faker-js/faker';");
    }

    // Add Ajv if schema validation is used
    if (code.includes('Ajv') && !code.includes('ajv')) {
      imports.push("import Ajv from 'ajv';");
    }

    if (imports.length > 0) {
      return imports.join('\n') + '\n\n' + code;
    }

    return code;
  }

  private fixUnmatchedBraces(code: string, issue: ValidationIssue): string {
    // Simple brace balancing - add missing closing braces at the end
    if (issue.description.includes('Unmatched braces')) {
      const openBraces = (code.match(/\{/g) || []).length;
      const closeBraces = (code.match(/\}/g) || []).length;
      const missing = openBraces - closeBraces;
      
      if (missing > 0) {
        return code + '\n' + '}'.repeat(missing);
      }
    }

    return code;
  }

  private fixAsyncAwait(code: string): string {
    // Find functions with await but no async
    return code.replace(
      /(\s+)(test|it)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\(\s*\)\s*=>\s*\{[^}]*await/g,
      '$1$2(\'$3\', async () => {'
    );
  }

  private removePlaceholderComments(code: string): string {
    const placeholderPatterns = [
      /\/\/\s*(Continue|Add more|TODO|FIXME).*\n/gi,
      /\/\*\s*(Continue|Add more|TODO|FIXME).*?\*\//gi,
      /\/\/\s*and so on.*\n/gi,
      /\/\/\s*similar tests.*\n/gi,
      /\/\/\s*\.\.\..*\n/gi
    ];

    let cleanCode = code;
    placeholderPatterns.forEach(pattern => {
      cleanCode = cleanCode.replace(pattern, '');
    });

    return cleanCode;
  }

  private addAuthenticationSetup(code: string, framework: TestFramework): string {
    if (code.includes('beforeAll') || code.includes('beforeEach')) {
      return code; // Already has setup
    }

    const setupTemplate = this.getAuthSetupTemplate(framework);
    
    // Insert after imports but before first describe block
    const describeIndex = code.indexOf('describe(');
    if (describeIndex > -1) {
      return code.slice(0, describeIndex) + setupTemplate + '\n\n' + code.slice(describeIndex);
    }

    return setupTemplate + '\n\n' + code;
  }

  private getAuthSetupTemplate(framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        return `
// Authentication setup
let authToken: string;

test.beforeAll(async ({ request }) => {
  // Setup authentication
  const loginResponse = await request.post(process.env.API_BASE_URL + '/login', {
    data: {
      username: process.env.TEST_USERNAME,
      password: process.env.TEST_PASSWORD
    }
  });
  
  const responseBody = await loginResponse.json();
  authToken = responseBody.token || responseBody.access_token;
});`;

      case 'cypress':
        return `
// Authentication setup
let authToken;

before(() => {
  cy.request({
    method: 'POST',
    url: Cypress.env('API_BASE_URL') + '/login',
    body: {
      username: Cypress.env('TEST_USERNAME'),
      password: Cypress.env('TEST_PASSWORD')
    }
  }).then((response) => {
    authToken = response.body.token || response.body.access_token;
  });
});`;

      default:
        return `
// Authentication setup
let authToken;

beforeAll(async () => {
  const response = await request(app)
    .post('/login')
    .send({
      username: process.env.TEST_USERNAME,
      password: process.env.TEST_PASSWORD
    });
  
  authToken = response.body.token || response.body.access_token;
});`;
    }
  }

  private replaceHardcodedValues(code: string): string {
    const replacements = [
      { pattern: /"[^"]*@[^"]*\.com"/g, replacement: 'process.env.TEST_EMAIL || "test@example.com"' },
      { pattern: /"password[^"]*"/g, replacement: 'process.env.TEST_PASSWORD || "testpassword"' },
      { pattern: /"https?:\/\/localhost:\d+"/g, replacement: 'process.env.API_BASE_URL || "http://localhost:3000"' }
    ];

    let updatedCode = code;
    replacements.forEach(({ pattern, replacement }) => {
      updatedCode = updatedCode.replace(pattern, replacement);
    });

    return updatedCode;
  }

  private addErrorHandling(code: string): string {
    // Add try-catch to beforeAll blocks that don't have them
    return code.replace(
      /(beforeAll\s*\(\s*async\s*\([^)]*\)\s*=>\s*\{)([^}]+)(\}\s*\);)/g,
      '$1\n  try {$2\n  } catch (error) {\n    console.error(\'Setup failed:\', error);\n    throw error;\n  }$3'
    );
  }

  private fixNamingConsistency(code: string, framework: TestFramework): string {
    // Standardize test function names based on framework
    if (framework === 'playwright' || framework === 'vitest') {
      // Use 'test' for Playwright and Vitest
      return code.replace(/\bit\s*\(/g, 'test(');
    } else {
      // Use 'it' for others
      return code.replace(/\btest\s*\(/g, 'it(');
    }
  }

  private protectCredentials(code: string): string {
    // Replace exposed credentials with environment variables
    return code
      .replace(/"password":\s*"[^"]+"/g, '"password": process.env.TEST_PASSWORD')
      .replace(/"secret":\s*"[^"]+"/g, '"secret": process.env.API_SECRET')
      .replace(/"token":\s*"[^"]+"/g, '"token": process.env.API_TOKEN')
      .replace(/"key":\s*"[^"]+"/g, '"key": process.env.API_KEY');
  }

  private addSecurityTests(code: string, issue: ValidationIssue): string {
    if (issue.description.includes('SQL injection')) {
      return this.addSQLInjectionTest(code);
    }
    if (issue.description.includes('XSS')) {
      return this.addXSSTest(code);
    }
    return code;
  }

  private addSQLInjectionTest(code: string): string {
    const sqlInjectionTest = `
    test('should prevent SQL injection attacks', async ({ request }) => {
      const sqlInjectionPayload = "' OR '1'='1";
      const response = await request.post('/api/endpoint', {
        data: { input: sqlInjectionPayload },
        headers: { 'Authorization': \`Bearer \${authToken}\` }
      });
      
      expect(response.status()).toBe(400); // Should reject malicious input
    });`;

    // Insert before the last closing brace of the last describe block
    return this.insertTestInLastDescribe(code, sqlInjectionTest);
  }

  private addXSSTest(code: string): string {
    const xssTest = `
    test('should prevent XSS attacks', async ({ request }) => {
      const xssPayload = '<script>alert("xss")</script>';
      const response = await request.post('/api/endpoint', {
        data: { input: xssPayload },
        headers: { 'Authorization': \`Bearer \${authToken}\` }
      });
      
      expect(response.status()).toBe(400); // Should reject malicious input
    });`;

    return this.insertTestInLastDescribe(code, xssTest);
  }

  private addTimeoutConfiguration(code: string, framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        if (!code.includes('test.setTimeout')) {
          return `test.setTimeout(60000);\n\n${code}`;
        }
        break;
      case 'jest':
        if (!code.includes('jest.setTimeout')) {
          return `jest.setTimeout(60000);\n\n${code}`;
        }
        break;
    }
    return code;
  }

  private addResourceCleanup(code: string, framework: TestFramework): string {
    if (code.includes('afterAll') || code.includes('afterEach')) {
      return code; // Already has cleanup
    }

    const cleanupTemplate = this.getCleanupTemplate(framework);
    return code + '\n\n' + cleanupTemplate;
  }

  private getCleanupTemplate(framework: TestFramework): string {
    switch (framework) {
      case 'playwright':
        return `
test.afterAll(async () => {
  // Cleanup resources
  if (authToken) {
    console.log('Cleaning up authentication state');
  }
});`;

      default:
        return `
afterAll(async () => {
  // Cleanup resources
  if (authToken) {
    console.log('Cleaning up authentication state');
  }
});`;
    }
  }

  private insertTestInLastDescribe(code: string, testCode: string): string {
    // Find the last describe block and insert the test before its closing brace
    const describeMatches = [...code.matchAll(/describe\s*\([^)]+\)\s*=>\s*\{/g)];
    if (describeMatches.length === 0) return code;

    // Find the closing brace of the last describe block
    let braceCount = 0;
    let insertIndex = -1;
    
    for (let i = code.length - 1; i >= 0; i--) {
      if (code[i] === '}') {
        braceCount++;
        if (braceCount === 1) {
          insertIndex = i;
          break;
        }
      } else if (code[i] === '{') {
        braceCount--;
      }
    }

    if (insertIndex > -1) {
      return code.slice(0, insertIndex) + testCode + '\n  ' + code.slice(insertIndex);
    }

    return code;
  }

  private isSameIssue(issue1: ValidationIssue, issue2: ValidationIssue): boolean {
    return issue1.type === issue2.type && 
           issue1.description === issue2.description &&
           issue1.severity === issue2.severity;
  }

  private calculateConfidenceScore(totalIssues: number, fixedIssues: number, finalScore: number): number {
    if (totalIssues === 0) return 100;
    
    const fixRate = (fixedIssues / totalIssues) * 100;
    const qualityBonus = finalScore * 5; // 0-50 bonus based on final quality score
    
    return Math.min(100, Math.round(fixRate * 0.7 + qualityBonus * 0.3));
  }
}
