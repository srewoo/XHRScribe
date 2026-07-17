import { RecordingSession, TestFramework } from '@/types';
import { SchemaExtractor } from '@/services/SchemaExtractor';
import { GraphQLSchemaInference } from '@/services/GraphQLSchemaInference';
import { EnvironmentExtractor } from '@/services/EnvironmentExtractor';
import { SecurityTestGenerator } from '@/services/SecurityTestGenerator';

type ExportResponse = { success: boolean; error?: string; [k: string]: any };

/**
 * Artifact-export logic extracted out of BackgroundService (plan.md 3.6).
 * Each method takes an already-resolved session and returns the response
 * payload; BackgroundService keeps session resolution + message plumbing.
 */
export class ExportController {
  private static instance: ExportController;
  static getInstance(): ExportController {
    if (!ExportController.instance) ExportController.instance = new ExportController();
    return ExportController.instance;
  }

  openAPI(session: RecordingSession): ExportResponse {
    try {
      const extractor = SchemaExtractor.getInstance();
      const spec = extractor.extractOpenAPISpec(session);
      const json = extractor.exportAsJSON(spec);
      return { success: true, content: json, spec };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'OpenAPI export failed' };
    }
  }

  graphQL(session: RecordingSession): ExportResponse {
    try {
      const inferrer = GraphQLSchemaInference.getInstance();
      const schema = inferrer.inferSchema(session);
      return { success: true, content: schema.sdl, schema };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'GraphQL schema export failed' };
    }
  }

  envFile(session: RecordingSession): ExportResponse {
    try {
      const extractor = EnvironmentExtractor.getInstance();
      const result = extractor.extractVariables(session);
      return { success: true, content: result.envFile, variables: result.variables, environments: result.environments };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Environment extraction failed' };
    }
  }

  securityReport(session: RecordingSession, framework?: TestFramework): ExportResponse {
    try {
      const generator = SecurityTestGenerator.getInstance();
      const suites = generator.generateSecurityTests(session);
      const testCodes = suites.map(suite => generator.generateSecurityTestCode(suite, framework || 'jest'));
      const overallRisk = suites.length > 0
        ? Math.round(suites.reduce((sum, s) => sum + s.riskScore, 0) / suites.length)
        : 0;
      return {
        success: true,
        suites,
        testCode: testCodes.join('\n\n'),
        overallRisk,
        totalTests: suites.reduce((sum, s) => sum + s.tests.length, 0),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Security report generation failed' };
    }
  }
}
