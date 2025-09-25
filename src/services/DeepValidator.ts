import { HARData, TestFramework } from '@/types';

export interface ValidationIssue {
  type: 'syntax' | 'logic' | 'completeness' | 'performance' | 'security' | 'business';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  location?: {
    line?: number;
    column?: number;
    function?: string;
  };
  suggestion?: string;
  autoFixable: boolean;
}

export interface DeepValidationResult {
  overallScore: number;
  isProductionReady: boolean;
  breakdown: {
    syntaxScore: number;
    completenessScore: number;
    coverageScore: number;
    qualityScore: number;
    securityScore: number;
    performanceScore: number;
  };
  detailedIssues: ValidationIssue[];
  improvementSuggestions: string[];
  estimatedFixTime: number; // in minutes
  readinessLevel: 'production' | 'staging' | 'development' | 'incomplete';
}

export class DeepValidator {
  private static instance: DeepValidator;

  static getInstance(): DeepValidator {
    if (!DeepValidator.instance) {
      DeepValidator.instance = new DeepValidator();
    }
    return DeepValidator.instance;
  }

  validateTestSuite(code: string, harData: HARData, framework: TestFramework): DeepValidationResult {
    const issues: ValidationIssue[] = [];
    
    console.log('🔍 Starting deep validation of generated test suite...');

    // 1. Syntax and compilation validation
    const syntaxValidation = this.validateSyntaxAndCompilation(code, framework);
    issues.push(...syntaxValidation.issues);

    // 2. Completeness validation
    const completenessValidation = this.validateCompleteness(code, harData, framework);
    issues.push(...completenessValidation.issues);

    // 3. Test coverage validation
    const coverageValidation = this.validateTestCoverage(code, harData);
    issues.push(...coverageValidation.issues);

    // 4. Code quality validation
    const qualityValidation = this.validateCodeQuality(code, framework);
    issues.push(...qualityValidation.issues);

    // 5. Security validation
    const securityValidation = this.validateSecurity(code);
    issues.push(...securityValidation.issues);

    // 6. Performance validation
    const performanceValidation = this.validatePerformance(code, framework);
    issues.push(...performanceValidation.issues);

    // 7. Business logic validation
    const businessValidation = this.validateBusinessLogic(code, harData);
    issues.push(...businessValidation.issues);

    // Calculate scores
    const breakdown = {
      syntaxScore: syntaxValidation.score,
      completenessScore: completenessValidation.score,
      coverageScore: coverageValidation.score,
      qualityScore: qualityValidation.score,
      securityScore: securityValidation.score,
      performanceScore: performanceValidation.score
    };

    const overallScore = this.calculateOverallScore(breakdown);
    const readinessLevel = this.determineReadinessLevel(overallScore, issues);
    const isProductionReady = readinessLevel === 'production';

    const result: DeepValidationResult = {
      overallScore,
      isProductionReady,
      breakdown,
      detailedIssues: issues,
      improvementSuggestions: this.generateImprovementSuggestions(issues, breakdown),
      estimatedFixTime: this.estimateFixTime(issues),
      readinessLevel
    };

    console.log(`📊 Deep validation completed: ${overallScore}/10 (${readinessLevel})`);
    
    return result;
  }

  private validateSyntaxAndCompilation(code: string, framework: TestFramework): { score: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let score = 10;

    // Check for basic syntax errors
    const syntaxErrors = this.checkBasicSyntax(code);
    syntaxErrors.forEach(error => {
      issues.push({
        type: 'syntax',
        severity: 'critical',
        description: error,
        autoFixable: true
      });
      score -= 2;
    });

    // Check for framework-specific syntax
    const frameworkErrors = this.checkFrameworkSyntax(code, framework);
    frameworkErrors.forEach(error => {
      issues.push({
        type: 'syntax',
        severity: 'high',
        description: error,
        autoFixable: true
      });
      score -= 1;
    });

    // Check for missing imports
    const importErrors = this.checkMissingImports(code, framework);
    importErrors.forEach(error => {
      issues.push({
        type: 'syntax',
        severity: 'critical',
        description: error,
        autoFixable: true
      });
      score -= 2;
    });

    return { score: Math.max(0, score), issues };
  }

  private validateCompleteness(code: string, harData: HARData, framework: TestFramework): { score: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let score = 10;

    const expectedEndpoints = harData.entries.length;
    const actualTestBlocks = this.countTestBlocks(code);
    const actualTestCases = this.countTestCases(code, framework);

    // Check endpoint coverage
    if (actualTestBlocks < expectedEndpoints) {
      issues.push({
        type: 'completeness',
        severity: 'critical',
        description: `Missing test blocks: expected ${expectedEndpoints}, found ${actualTestBlocks}`,
        autoFixable: false
      });
      score -= 3;
    }

    // Check for minimum test cases per endpoint
    const minTestCasesPerEndpoint = 5;
    const expectedMinTestCases = expectedEndpoints * minTestCasesPerEndpoint;
    if (actualTestCases < expectedMinTestCases) {
      issues.push({
        type: 'completeness',
        severity: 'high',
        description: `Insufficient test cases: expected at least ${expectedMinTestCases}, found ${actualTestCases}`,
        autoFixable: false
      });
      score -= 2;
    }

    // Check for placeholder comments
    const placeholders = this.findPlaceholderComments(code);
    placeholders.forEach(placeholder => {
      issues.push({
        type: 'completeness',
        severity: 'critical',
        description: `Placeholder comment found: ${placeholder}`,
        autoFixable: true
      });
      score -= 2;
    });

    // Check for authentication setup
    if (!this.hasAuthenticationSetup(code)) {
      issues.push({
        type: 'completeness',
        severity: 'high',
        description: 'Missing authentication setup (beforeAll/beforeEach)',
        autoFixable: true
      });
      score -= 1;
    }

    return { score: Math.max(0, score), issues };
  }

  private validateTestCoverage(code: string, harData: HARData): { score: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let score = 10;

    // Check for different types of tests
    const testTypes = {
      happy: this.countHappyPathTests(code),
      error: this.countErrorTests(code),
      edge: this.countEdgeCaseTests(code),
      security: this.countSecurityTests(code),
      performance: this.countPerformanceTests(code)
    };

    // Validate test type coverage
    Object.entries(testTypes).forEach(([type, count]) => {
      if (count === 0) {
        issues.push({
          type: 'completeness',
          severity: type === 'happy' ? 'critical' : 'medium',
          description: `Missing ${type} path tests`,
          autoFixable: false
        });
        score -= type === 'happy' ? 3 : 1;
      }
    });

    // Check for comprehensive error code coverage
    const errorCodes = [400, 401, 403, 404, 422, 500];
    const missingErrorCodes = errorCodes.filter(code => 
      !this.hasErrorCodeTest(code.toString(), code.toString())
    );

    if (missingErrorCodes.length > 0) {
      issues.push({
        type: 'completeness',
        severity: 'medium',
        description: `Missing error code tests for: ${missingErrorCodes.join(', ')}`,
        autoFixable: true
      });
      score -= missingErrorCodes.length * 0.5;
    }

    return { score: Math.max(0, score), issues };
  }

  private validateCodeQuality(code: string, framework: TestFramework): { score: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let score = 10;

    // Check for hardcoded values
    const hardcodedValues = this.findHardcodedValues(code);
    hardcodedValues.forEach(value => {
      issues.push({
        type: 'logic',
        severity: 'medium',
        description: `Hardcoded value found: ${value}`,
        suggestion: 'Replace with environment variable or configuration',
        autoFixable: true
      });
      score -= 0.5;
    });

    // Check for proper error handling
    if (!this.hasProperErrorHandling(code)) {
      issues.push({
        type: 'logic',
        severity: 'high',
        description: 'Missing proper error handling in test setup',
        autoFixable: true
      });
      score -= 2;
    }

    // Check for consistent naming
    const namingIssues = this.checkNamingConsistency(code, framework);
    namingIssues.forEach(issue => {
      issues.push({
        type: 'logic',
        severity: 'low',
        description: issue,
        autoFixable: true
      });
      score -= 0.2;
    });

    // Check for proper async/await usage
    const asyncIssues = this.checkAsyncAwaitUsage(code);
    asyncIssues.forEach(issue => {
      issues.push({
        type: 'logic',
        severity: 'medium',
        description: issue,
        autoFixable: true
      });
      score -= 1;
    });

    return { score: Math.max(0, score), issues };
  }

  private validateSecurity(code: string): { score: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let score = 10;

    // Check for exposed credentials
    const credentialExposures = this.findExposedCredentials(code);
    credentialExposures.forEach(exposure => {
      issues.push({
        type: 'security',
        severity: 'critical',
        description: `Potential credential exposure: ${exposure}`,
        suggestion: 'Use environment variables for sensitive data',
        autoFixable: true
      });
      score -= 3;
    });

    // Check for SQL injection test coverage
    if (!this.hasSQLInjectionTests(code)) {
      issues.push({
        type: 'security',
        severity: 'medium',
        description: 'Missing SQL injection protection tests',
        autoFixable: true
      });
      score -= 1;
    }

    // Check for XSS test coverage
    if (!this.hasXSSTests(code)) {
      issues.push({
        type: 'security',
        severity: 'medium',
        description: 'Missing XSS protection tests',
        autoFixable: true
      });
      score -= 1;
    }

    return { score: Math.max(0, score), issues };
  }

  private validatePerformance(code: string, framework: TestFramework): { score: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let score = 10;

    // Check for timeout configurations
    if (!this.hasTimeoutConfiguration(code, framework)) {
      issues.push({
        type: 'performance',
        severity: 'medium',
        description: 'Missing timeout configuration for tests',
        autoFixable: true
      });
      score -= 1;
    }

    // Check for performance assertions
    if (!this.hasPerformanceAssertions(code)) {
      issues.push({
        type: 'performance',
        severity: 'low',
        description: 'Missing performance/response time assertions',
        autoFixable: true
      });
      score -= 0.5;
    }

    // Check for resource cleanup
    if (!this.hasResourceCleanup(code, framework)) {
      issues.push({
        type: 'performance',
        severity: 'medium',
        description: 'Missing resource cleanup (afterAll/afterEach)',
        autoFixable: true
      });
      score -= 1;
    }

    return { score: Math.max(0, score), issues };
  }

  private validateBusinessLogic(code: string, harData: HARData): { score: number; issues: ValidationIssue[] } {
    const issues: ValidationIssue[] = [];
    let score = 10;

    // Check for data validation
    if (!this.hasDataValidation(code)) {
      issues.push({
        type: 'business',
        severity: 'medium',
        description: 'Missing response data validation/schema checks',
        autoFixable: true
      });
      score -= 1;
    }

    // Check for business rule tests
    const businessRuleTests = this.countBusinessRuleTests(code);
    if (businessRuleTests === 0) {
      issues.push({
        type: 'business',
        severity: 'low',
        description: 'Missing business logic validation tests',
        autoFixable: false
      });
      score -= 0.5;
    }

    return { score: Math.max(0, score), issues };
  }

  // Helper methods for validation checks
  private checkBasicSyntax(code: string): string[] {
    const errors: string[] = [];

    // Check for unmatched braces
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push(`Unmatched braces: ${openBraces} opening, ${closeBraces} closing`);
    }

    // Check for unmatched parentheses
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push(`Unmatched parentheses: ${openParens} opening, ${closeParens} closing`);
    }

    // Check for semicolon issues (basic check)
    const missingSemicolons = code.match(/\n\s*[^\/\s][^;]*[^{\s;]\s*\n/g);
    if (missingSemicolons && missingSemicolons.length > 5) {
      errors.push('Multiple potential missing semicolons detected');
    }

    return errors;
  }

  private checkFrameworkSyntax(code: string, framework: TestFramework): string[] {
    const errors: string[] = [];

    switch (framework) {
      case 'playwright':
        if (code.includes('describe(') && !code.includes('import') && !code.includes('test')) {
          errors.push('Playwright requires test import and test() functions');
        }
        break;
      case 'cypress':
        if (code.includes('async/await') && !code.includes('cy.then')) {
          errors.push('Cypress async/await usage should use cy.then() pattern');
        }
        break;
      case 'jest':
        if (code.includes('describe(') && !code.includes('expect(')) {
          errors.push('Jest tests should use expect() assertions');
        }
        break;
    }

    return errors;
  }

  private checkMissingImports(code: string, framework: TestFramework): string[] {
    const errors: string[] = [];

    const frameworkImports = {
      playwright: ['@playwright/test'],
      cypress: [], // Cypress provides globals
      jest: ['supertest'], // Often used with Jest
      vitest: ['vitest']
    };

    const requiredImports = frameworkImports[framework] || [];
    
    requiredImports.forEach(importName => {
      if (!code.includes(importName)) {
        errors.push(`Missing import for ${importName}`);
      }
    });

    return errors;
  }

  private countTestBlocks(code: string): number {
    return (code.match(/describe\s*\(/g) || []).length;
  }

  private countTestCases(code: string, framework?: string): number {
    switch (framework) {
      case 'restassured':
        // Count Java @Test methods
        return (code.match(/@Test\s+public\s+void/g) || []).length;
      case 'postman':
        // Count test scripts in Postman collection
        return (code.match(/"test"/g) || []).length;
      case 'playwright':
        // Count Playwright test() calls
        return (code.match(/test\(/g) || []).length;
      case 'cypress':
        // Count it() calls in Cypress
        return (code.match(/it\(/g) || []).length;
      default:
        // Default JS/TS test patterns
        return (code.match(/(test|it)\s*\(/g) || []).length;
    }
  }

  private findPlaceholderComments(code: string): string[] {
    const placeholderPatterns = [
      /\/\/ (Continue|Add more|TODO|FIXME|Follow pattern)/gi,
      /\/\* (Continue|Add more|TODO|FIXME) /gi,
      /and so on/gi,
      /similar tests/gi,
      /\.\.\./g
    ];

    const placeholders: string[] = [];
    placeholderPatterns.forEach(pattern => {
      const matches = code.match(pattern);
      if (matches) {
        placeholders.push(...matches);
      }
    });

    return placeholders;
  }

  private hasAuthenticationSetup(code: string): boolean {
    return code.includes('beforeAll') || code.includes('beforeEach') || 
           code.includes('before(') || code.includes('setUp');
  }

  private countHappyPathTests(code: string): number {
    const happyPatterns = [
      /should.*success/gi,
      /should.*work/gi,
      /should.*return.*200/gi,
      /valid.*request/gi
    ];

    return happyPatterns.reduce((count, pattern) => {
      return count + (code.match(pattern) || []).length;
    }, 0);
  }

  private countErrorTests(code: string): number {
    const errorPatterns = [
      /should.*return.*4\d\d/gi,
      /should.*return.*5\d\d/gi,
      /should.*error/gi,
      /should.*fail/gi
    ];

    return errorPatterns.reduce((count, pattern) => {
      return count + (code.match(pattern) || []).length;
    }, 0);
  }

  private countEdgeCaseTests(code: string): number {
    const edgePatterns = [
      /edge.*case/gi,
      /boundary/gi,
      /empty.*value/gi,
      /null.*value/gi,
      /maximum/gi,
      /minimum/gi
    ];

    return edgePatterns.reduce((count, pattern) => {
      return count + (code.match(pattern) || []).length;
    }, 0);
  }

  private countSecurityTests(code: string): number {
    const securityPatterns = [
      /injection/gi,
      /xss/gi,
      /security/gi,
      /authentication.*bypass/gi
    ];

    return securityPatterns.reduce((count, pattern) => {
      return count + (code.match(pattern) || []).length;
    }, 0);
  }

  private countPerformanceTests(code: string): number {
    const perfPatterns = [
      /performance/gi,
      /response.*time/gi,
      /timeout/gi,
      /load.*test/gi
    ];

    return perfPatterns.reduce((count, pattern) => {
      return count + (code.match(pattern) || []).length;
    }, 0);
  }

  private hasErrorCodeTest(code: string, errorCode: string): boolean {
    return code.includes(errorCode) && code.includes('expect');
  }

  private findHardcodedValues(code: string): string[] {
    const hardcoded: string[] = [];
    
    // Look for hardcoded URLs, emails, passwords
    const patterns = [
      /"[^"]*@[^"]*\.com"/g, // emails
      /"https?:\/\/[^"]*"/g, // URLs (that aren't env vars)
      /"password[^"]*"/g, // passwords
      /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/g // UUIDs
    ];

    patterns.forEach(pattern => {
      const matches = code.match(pattern);
      if (matches) {
        // Filter out environment variable references
        const actualHardcoded = matches.filter(match => 
          !match.includes('process.env') && !match.includes('${')
        );
        hardcoded.push(...actualHardcoded);
      }
    });

    return hardcoded;
  }

  private hasProperErrorHandling(code: string): boolean {
    return code.includes('try') && code.includes('catch') ||
           code.includes('.catch(') ||
           code.includes('Error(');
  }

  private checkNamingConsistency(code: string, framework: TestFramework): string[] {
    const issues: string[] = [];

    // Check for mixed test function names
    const hasTest = code.includes('test(');
    const hasIt = code.includes('it(');
    
    if (hasTest && hasIt) {
      issues.push('Mixed test function names: use either test() or it() consistently');
    }

    return issues;
  }

  private checkAsyncAwaitUsage(code: string): string[] {
    const issues: string[] = [];

    // Check for await without async
    const awaitWithoutAsync = code.match(/^(?!.*async).*await/gm);
    if (awaitWithoutAsync) {
      issues.push('Found await without async function declaration');
    }

    return issues;
  }

  private findExposedCredentials(code: string): string[] {
    const exposed: string[] = [];
    
    const credentialPatterns = [
      /"password":\s*"[^"]+"/g,
      /"secret":\s*"[^"]+"/g,
      /"token":\s*"[^"]+"/g,
      /"key":\s*"[^"]+"/g
    ];

    credentialPatterns.forEach(pattern => {
      const matches = code.match(pattern);
      if (matches) {
        // Filter out test/placeholder values
        const actualCredentials = matches.filter(match => 
          !match.includes('test') && 
          !match.includes('fake') && 
          !match.includes('process.env') &&
          !match.includes('${')
        );
        exposed.push(...actualCredentials);
      }
    });

    return exposed;
  }

  private hasSQLInjectionTests(code: string): boolean {
    return code.includes('SQL') || code.includes('injection') || code.includes("' OR '1'='1");
  }

  private hasXSSTests(code: string): boolean {
    return code.includes('XSS') || code.includes('<script>') || code.includes('xss');
  }

  private hasTimeoutConfiguration(code: string, framework: TestFramework): boolean {
    const timeoutPatterns = ['timeout', 'setTimeout', 'jest.setTimeout'];
    return timeoutPatterns.some(pattern => code.includes(pattern));
  }

  private hasPerformanceAssertions(code: string): boolean {
    return code.includes('response') && (code.includes('time') || code.includes('duration'));
  }

  private hasResourceCleanup(code: string, framework: TestFramework): boolean {
    return code.includes('afterAll') || code.includes('afterEach') || code.includes('after(');
  }

  private hasDataValidation(code: string): boolean {
    return code.includes('schema') || code.includes('validate') || code.includes('Ajv');
  }

  private countBusinessRuleTests(code: string): number {
    const businessPatterns = [
      /business.*logic/gi,
      /business.*rule/gi,
      /domain.*logic/gi
    ];

    return businessPatterns.reduce((count, pattern) => {
      return count + (code.match(pattern) || []).length;
    }, 0);
  }

  private calculateOverallScore(breakdown: DeepValidationResult['breakdown']): number {
    const weights = {
      syntaxScore: 0.25,      // 25% - Critical for functionality
      completenessScore: 0.25, // 25% - Critical for coverage
      coverageScore: 0.20,     // 20% - Important for reliability
      qualityScore: 0.15,      // 15% - Important for maintainability
      securityScore: 0.10,     // 10% - Important for production
      performanceScore: 0.05   // 5% - Nice to have
    };

    const weightedScore = Object.entries(breakdown).reduce((total, [key, score]) => {
      const weight = weights[key as keyof typeof weights] || 0;
      return total + (score * weight);
    }, 0);

    return Math.round(weightedScore * 10) / 10; // Round to 1 decimal place
  }

  private determineReadinessLevel(score: number, issues: ValidationIssue[]): DeepValidationResult['readinessLevel'] {
    const criticalIssues = issues.filter(i => i.severity === 'critical').length;
    const highIssues = issues.filter(i => i.severity === 'high').length;

    if (criticalIssues > 0) return 'incomplete';
    if (score >= 9 && highIssues === 0) return 'production';
    if (score >= 7 && highIssues <= 2) return 'staging';
    if (score >= 5) return 'development';
    return 'incomplete';
  }

  private generateImprovementSuggestions(issues: ValidationIssue[], breakdown: DeepValidationResult['breakdown']): string[] {
    const suggestions: string[] = [];

    // Priority suggestions based on lowest scores
    const sortedScores = Object.entries(breakdown).sort(([,a], [,b]) => a - b);
    
    sortedScores.forEach(([category, score]) => {
      if (score < 8) {
        switch (category) {
          case 'syntaxScore':
            suggestions.push('🔧 Fix syntax errors and add missing imports for immediate functionality');
            break;
          case 'completenessScore':
            suggestions.push('📝 Add missing test cases and remove placeholder comments');
            break;
          case 'coverageScore':
            suggestions.push('🎯 Increase test coverage with error scenarios and edge cases');
            break;
          case 'qualityScore':
            suggestions.push('✨ Improve code quality by replacing hardcoded values with environment variables');
            break;
          case 'securityScore':
            suggestions.push('🔒 Add security tests for injection attacks and credential protection');
            break;
          case 'performanceScore':
            suggestions.push('⚡ Add timeout configurations and performance assertions');
            break;
        }
      }
    });

    // Specific suggestions based on issue types
    const criticalIssues = issues.filter(i => i.severity === 'critical');
    if (criticalIssues.length > 0) {
      suggestions.unshift('🚨 CRITICAL: Address all critical issues before deployment');
    }

    const autoFixableIssues = issues.filter(i => i.autoFixable);
    if (autoFixableIssues.length > 0) {
      suggestions.push(`🤖 ${autoFixableIssues.length} issues can be auto-fixed using the intelligent fix system`);
    }

    return suggestions;
  }

  private estimateFixTime(issues: ValidationIssue[]): number {
    // Estimate time in minutes based on issue severity and type
    const timeEstimates = {
      critical: { syntax: 5, logic: 15, completeness: 30, performance: 10, security: 20, business: 25 },
      high: { syntax: 3, logic: 10, completeness: 20, performance: 8, security: 15, business: 20 },
      medium: { syntax: 2, logic: 5, completeness: 10, performance: 5, security: 10, business: 15 },
      low: { syntax: 1, logic: 3, completeness: 5, performance: 3, security: 5, business: 10 }
    };

    return issues.reduce((total, issue) => {
      const estimate = timeEstimates[issue.severity]?.[issue.type] || 5;
      return total + estimate;
    }, 0);
  }
}
