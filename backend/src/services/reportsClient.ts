import { env } from '../config/env';

/**
 * Read-only client for the HorizonX platform Reports API (Hard rule 1):
 * HTTPS GET only, authenticated with the X-Report-Key header. Nothing else.
 */
export class ReportsApiError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'ReportsApiError';
  }
}

const RETRY_DELAYS_MS = [2000, 4000, 8000];
const NO_RETRY_STATUSES = [401, 403, 404];

async function getJson(path: string): Promise<unknown> {
  if (!env.platformBaseUrl || !env.reportApiKey) {
    throw new ReportsApiError(
      'PLATFORM_BASE_URL / REPORT_API_KEY are not configured — cannot reach the Reports API'
    );
  }
  const url = new URL(path, env.platformBaseUrl).toString();
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'X-Report-Key': env.reportApiKey, Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new ReportsApiError(`Reports API responded ${res.status} for GET ${path}`, res.status);
      }
      // The platform SPA answers unknown routes with 200 + HTML. Treat that as
      // "endpoint missing", never as data.
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new ReportsApiError(
          `Reports API returned non-JSON (${contentType || 'no content-type'}) for GET ${path} — the endpoint probably does not exist on the platform yet`,
          res.status
        );
      }
      return (await res.json()) as unknown;
    } catch (err) {
      lastError = err;
      if (err instanceof ReportsApiError && err.status && NO_RETRY_STATUSES.includes(err.status)) {
        break;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// Real platform endpoints (verified live 2026-07-10). The per-client context
// endpoint from the original spec does not exist yet on the platform.
export const reportsApi = {
  overview: () => getJson('/api/agent-reports/overview'),
  health: () => getJson('/api/agent-reports/health'),
  clientContext: (organizationId: string) =>
    getJson(`/api/agent-reports/clients/${encodeURIComponent(organizationId)}/context`),
};
