import { Settings } from '@/types';

/**
 * Pure request-classification logic extracted from BackgroundService.
 *
 * Decides whether a captured request is an API call worth recording, and
 * whether it passes the user's configured capture filters. Kept side-effect
 * free so it is directly unit-testable and doesn't bloat the background
 * service's lifecycle code.
 */

const STATIC_EXTENSIONS = [
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.map', '.wasm', '.webp', '.avif',
];

const NON_API_PATTERNS = [
  '/collect', '/track', '/analytics', '/metrics', '/beacon',
  '/pixel', '/impression', '/adserver', '/ads/', '/gtag/',
  '/ga/', '/gtm.js', 'google-analytics', 'googletagmanager',
  'facebook.com/tr', 'doubleclick.net', '/pagead/',
  'hotjar', 'fullstory', 'segment.io', 'mixpanel',
  'sentry.io/api', 'bugsnag', 'newrelic', 'datadog',
  '/favicon', '/_next/static', '/_nuxt/static',
];

const STRONG_API_PATTERNS = [
  '/api/', '/wapi/', '/webapi/', '/v1/', '/v2/', '/v3/', '/v4/', '/v5/',
  '/graphql', '/rest/', '/rpc/', '/grpc/',
  '/auth/', '/login', '/logout', '/signin', '/signout',
  '/token', '/oauth', '/sso',
];

const STRONG_DOMAIN_PATTERNS = ['api.', 'gateway.', 'backend.', 'rest.'];

const WEAK_API_PATTERNS = [
  '.json', '.xml', '/data/', '/service/',
  '/search', '/filter', '/query',
  '/upload', '/download', '/export', '/import',
  '/webhook', '/events', '/stream',
];

const API_CONTENT_TYPES = [
  'application/json', 'application/xml', 'application/x-www-form-urlencoded',
  'multipart/form-data', 'application/protobuf', 'application/msgpack',
  'application/grpc', 'application/x-protobuf', 'application/octet-stream',
];

const API_ACCEPT_TYPES = [
  'application/json', 'application/xml', 'text/xml',
  'application/hal+json', 'application/vnd.api+json',
];

const AUTH_URL_PATTERNS = [
  '/auth', '/login', '/logout', '/signin', '/signout',
  '/token', '/refresh', '/session', '/user', '/profile',
  '/oauth', '/sso', '/saml', '/oidc', '/jwt',
];

const AUTH_HEADER_NAMES = [
  'authorization', 'x-auth-token', 'x-access-token', 'x-api-key',
  'x-session-id', 'x-csrf-token', 'x-xsrf-token',
];

const AUTH_COOKIE_PATTERNS = [
  'session', 'auth', 'token', 'login', 'userid', 'companyid',
  '_csrf', 'PLAY_SESSION', 'connect.sid',
];

const AUTH_QUERY_PARAMS = [
  'token', 'auth', 'session', 'userid', 'companyid',
  'access_token', 'refresh_token', 'api_key',
];

export function hasApiContentType(headers: Record<string, string>): boolean {
  const contentType = headers['content-type'] || headers['Content-Type'] || '';
  const acceptHeader = headers['accept'] || headers['Accept'] || '';
  return API_CONTENT_TYPES.some(t => contentType.includes(t)) ||
    API_ACCEPT_TYPES.some(t => acceptHeader.includes(t));
}

function hasAuthenticationHeaders(headers: Record<string, string>): boolean {
  return AUTH_HEADER_NAMES.some(name =>
    Object.keys(headers).some(key => key.toLowerCase() === name)
  );
}

function hasAuthenticationCookies(headers: Record<string, string>): boolean {
  const cookieHeader = headers['cookie'] || headers['Cookie'] || '';
  return AUTH_COOKIE_PATTERNS.some(p => cookieHeader.toLowerCase().includes(p.toLowerCase()));
}

function hasAuthenticationQueryParams(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return AUTH_QUERY_PARAMS.some(param => urlObj.searchParams.has(param));
  } catch {
    return ['token=', 'auth=', 'session=', 'userid=', 'access_token=', 'api_key=']
      .some(p => url.toLowerCase().includes(p));
  }
}

export function isAuthenticationRelated(url: string, request?: any): boolean {
  const headers = request?.headers || {};
  return AUTH_URL_PATTERNS.some(p => url.toLowerCase().includes(p)) ||
    hasAuthenticationHeaders(headers) ||
    hasAuthenticationCookies(headers) ||
    hasAuthenticationQueryParams(url);
}

function isSinglePageAppApiCall(initiator: any, url: string): boolean {
  if (!initiator) return false;
  const isSpaInitiator = initiator.type === 'script' || initiator.type === 'fetch';
  const spaPatterns = ['_next/', '_nuxt/', '__webpack', '__vite', '/_app/', '/api/', '/trpc/', '/graphql', '/_server/'];
  const hasSpaPattern = spaPatterns.some(p => url.includes(p));
  const hasAjaxHeaders = initiator?.stack && typeof initiator.stack === 'string' &&
    (initiator.stack.includes('XMLHttpRequest') || initiator.stack.includes('fetch') || initiator.stack.includes('axios'));
  return isSpaInitiator && (hasSpaPattern || hasAjaxHeaders);
}

/** Whether a captured request looks like an API call worth recording. */
export function isApiRequest(url: string, type: string, request?: any, initiator?: any): boolean {
  const urlLower = url.toLowerCase();

  // Match static extensions against the path ending only, so `.js` doesn't
  // wrongly match `.json` (which would drop legitimate JSON API responses).
  let pathLower = urlLower;
  try { pathLower = new URL(url).pathname.toLowerCase(); } catch { /* keep urlLower */ }
  if (STATIC_EXTENSIONS.some(ext => pathLower.endsWith(ext))) return false;
  if (NON_API_PATTERNS.some(p => urlLower.includes(p))) return false;

  // XHR/Fetch, strong URL pattern, API content-type, or API subdomain each suffice.
  if (type === 'XHR' || type === 'Fetch') return true;
  if (STRONG_API_PATTERNS.some(p => urlLower.includes(p))) return true;
  if (hasApiContentType(request?.headers || {})) return true;
  if (STRONG_DOMAIN_PATTERNS.some(p => urlLower.includes(p))) return true;

  // Otherwise require at least two weaker signals.
  const isNonGetMethod = request?.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
  const isAuthRelated = isAuthenticationRelated(url, request);
  const isSpaApiCall = isSinglePageAppApiCall(initiator, url);
  const hasWeakApiPattern = WEAK_API_PATTERNS.some(p => urlLower.includes(p));

  return [isNonGetMethod, isAuthRelated, isSpaApiCall, hasWeakApiPattern].filter(Boolean).length >= 2;
}

/**
 * Apply the user-configured capture filters. `filtering` is the cached
 * settings' filtering block (or undefined if not loaded yet — in which case
 * everything passes and masking still runs later at stop-recording).
 */
export function passesUserFilters(
  url: string,
  requestType: string,
  filtering?: Settings['filtering']
): boolean {
  if (!filtering) return true;

  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { /* keep '' */ }

  const matches = (domain: string) => {
    const d = domain.trim().toLowerCase();
    return !!d && (host === d || host.endsWith(`.${d}`));
  };

  if (filtering.excludeDomains?.length && filtering.excludeDomains.some(matches)) return false;
  if (filtering.includeDomains?.length && !filtering.includeDomains.some(matches)) return false;
  if (filtering.includeTypes?.length && !filtering.includeTypes.includes(requestType as any)) return false;
  return true;
}
