/**
 * Logic shared verbatim across the Claude / OpenAI / Gemini providers.
 *
 * These functions were previously copy-pasted (byte-identical) into all three
 * providers. They are provider-agnostic: GraphQL detection, operation-name
 * extraction, a stable hash, and the per-model context-window limits.
 *
 * NOTE: the larger per-provider methods (getFrameworkInstructions,
 * calculateQualityScore, analyzeCode, generateSuggestions) genuinely DIFFER
 * between providers and are intentionally NOT merged here — unifying them would
 * change what each provider sends to its model, which needs output/eval tests
 * first. See plan.md 3.1.
 */

/** 32-bit string hash, hex, 8 chars — used for stable GraphQL operation ids. */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

export function looksLikeGraphQL(requestBody: any): boolean {
  if (!requestBody) return false;

  try {
    const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
    const body = typeof requestBody === 'object' ? requestBody : JSON.parse(bodyStr);

    // Check for GraphQL query patterns
    return !!(body.query || body.operationName || body.variables ||
              bodyStr.includes('query ') || bodyStr.includes('mutation ') ||
              bodyStr.includes('subscription '));
  } catch {
    return false;
  }
}

export function isGraphQLEndpoint(pathname: string, request: any): boolean {
  return pathname.includes('graphql') || pathname.includes('gql') ||
         (request.postData?.text && looksLikeGraphQL(request.postData.text));
}

export function extractGraphQLOperation(request: any): string | null {
  const requestBody = request.postData?.text;
  if (!requestBody) return null;

  try {
    const bodyStr = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody);
    const body = typeof requestBody === 'object' ? requestBody : JSON.parse(bodyStr);

    // Priority 1: Use operationName if available
    if (body.operationName && typeof body.operationName === 'string') {
      return body.operationName;
    }

    // Priority 2: Extract operation name from query string
    if (body.query && typeof body.query === 'string') {
      const queryMatch = body.query.match(/(?:query|mutation|subscription)\s+([a-zA-Z][a-zA-Z0-9_]*)/);
      if (queryMatch && queryMatch[1]) {
        return queryMatch[1];
      }

      // Priority 3: Use operation type + hash for unnamed operations
      const operationType = body.query.trim().match(/^(query|mutation|subscription)/);
      if (operationType) {
        const queryHash = simpleHash(body.query);
        return `${operationType[1]}_${queryHash}`;
      }
    }

    // Priority 4: Fallback to request body hash
    const bodyHash = simpleHash(bodyStr);
    return `operation_${bodyHash}`;

  } catch {
    return null;
  }
}

/**
 * Context-window token limits per model. Keys are disjoint across providers,
 * so a single map is unambiguous. Callers pass their own fallback for unknown
 * models to preserve each provider's prior default behaviour.
 */
export const MODEL_TOKEN_LIMITS: Record<string, number> = {
  // Anthropic Claude
  'claude-opus-4-8': 200000,
  'claude-sonnet-4-6': 200000,
  'claude-haiku-4-5-20251001': 200000,
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4.1': 1000000,
  'gpt-4.1-mini': 1000000,
  // Google Gemini
  'gemini-2.5-flash': 1048576,
  'gemini-2.5-pro': 2097152,
  'gemini-2.0-flash': 1048576,
};

export function getModelTokenLimit(model: string, fallback: number): number {
  return MODEL_TOKEN_LIMITS[model] ?? fallback;
}
