import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { resolveApiOrigin } from './api-client.js';
import { normalizeProjectId, projectCredentialRefs } from './project-context.js';

const maxAuthResponseBytes = 32 * 1024;

function configuredProject(settings, projectId) {
  return settings?.projects?.find(project => normalizeProjectId(project?.projectId) === projectId);
}

function responseError(status) {
  if (status === 401) return 'GEO rejected this project token. It may be expired, revoked, or invalid.';
  if (status === 403) return 'GEO rejected this project token for the configured project or requested scope.';
  if (status === 429) return 'GEO authentication is rate limited. Wait before checking the connection again.';
  if (status >= 500) return 'GEO authentication service is unavailable.';
  return 'GEO project-token validation failed. Check the token and project configuration.';
}

function validateToken(value, projectId, tokenPrefix) {
  const tokenBody = typeof value === 'string' && value.startsWith(tokenPrefix)
    ? value.slice(tokenPrefix.length)
    : '';
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(tokenBody)) {
    throw new Error(`GEO project ${projectId} has no valid project API token configured in DSH Credentials.`);
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : 'GEO project-token validation failed.';
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxAuthResponseBytes) {
    throw new Error('GEO authentication response exceeded the safety limit.');
  }
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error('GEO authentication returned an unreadable response.');
  }
  if (Buffer.byteLength(text, 'utf8') > maxAuthResponseBytes) {
    throw new Error('GEO authentication response exceeded the safety limit.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(responseError(response.status));
  }
}

export function createGeoAuthProvider({
  credentials,
  baseUrl,
  timeoutMs = 30_000,
  serverPath = '/geo',
  projects,
  tokenPrefix = 'geop_',
  getSettings,
  fetchImpl = fetch,
}) {
  const resolveSettings = settings => settings ?? getSettings?.() ?? { baseUrl, timeoutMs, projects };

  async function resolveToken(projectId) {
    if (typeof credentials?.resolve !== 'function') return undefined;
    const ref = credentialRef(projectCredentialRefs(projectId).apiToken);
    const entry = await credentials.resolve(ref);
    if (typeof entry?.value !== 'string' || entry.value.length === 0) return undefined;
    return validateToken(entry.value, projectId, tokenPrefix);
  }

  function endpointFor(settings, projectId) {
    if (!configuredProject(settings, projectId)) {
      throw new Error(`GEO project ${projectId} is not configured in GEO 工作台.`);
    }
    let origin;
    try {
      origin = resolveApiOrigin(settings?.baseUrl);
    } catch {
      throw new Error('在 GEO 工作台配置一个有效的 GEO 服务地址后，才能使用项目令牌。');
    }
    const url = new URL(origin);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('GEO 项目令牌要求使用 HTTPS；内网 IP 地址也必须配置 HTTPS。');
    }
    const servicePath = `${String(serverPath || '/geo').replace(/\/$/, '')}/auth/project-token-context`;
    return { origin, url: new URL(servicePath, `${origin}/`) };
  }

  async function currentToken(projectIdValue, settingsOverride) {
    const projectId = normalizeProjectId(projectIdValue);
    if (!projectId) throw new Error('A valid GEO projectId is required to select project credentials.');
    const settings = resolveSettings(settingsOverride);
    endpointFor(settings, projectId);
    let token;
    try {
      token = await resolveToken(projectId);
    } catch (error) {
      throw new Error(errorMessage(error));
    }
    if (!token) {
      throw new Error(`GEO project ${projectId} has no project API token configured. Paste a token created for this project into DSH Credentials.`);
    }
    return { projectId, token };
  }

  async function requestContext(projectIdValue, settingsOverride) {
    const projectId = normalizeProjectId(projectIdValue);
    if (!projectId) throw new Error('A valid GEO projectId is required to select project credentials.');
    const settings = resolveSettings(settingsOverride);
    const { url } = endpointFor(settings, projectId);
    const { token } = await currentToken(projectId, settings);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(Number.isFinite(settings?.timeoutMs) ? settings.timeoutMs : timeoutMs),
      });
    } catch {
      throw new Error('GEO project-token validation could not reach the configured service.');
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('GEO authentication returned a redirect. It was not followed to protect the project token.');
    }
    const envelope = await readBoundedJson(response);
    const data = envelope?.data;
    if (!response.ok || envelope?.code !== 200 || !data || typeof data !== 'object') {
      throw new Error(responseError(response.status));
    }
    const boundProjectId = normalizeProjectId(data.projectId);
    if (boundProjectId !== projectId) {
      throw new Error(`The configured token is bound to GEO project ${boundProjectId ?? 'unknown'}, not project ${projectId}.`);
    }
    if (!Array.isArray(data.scopes) || typeof data.expiresAt !== 'string') {
      throw new Error('GEO returned an incomplete project-token context.');
    }
    const expiresAt = new Date(data.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error('GEO returned an invalid project-token expiry.');
    }
    return {
      projectId,
      projectName: typeof data.projectName === 'string' ? data.projectName : undefined,
      tokenName: typeof data.tokenName === 'string' ? data.tokenName : undefined,
      scopes: data.scopes.filter(scope => typeof scope === 'string'),
      expiresAt: expiresAt.toISOString(),
    };
  }

  return {
    async getAccessToken(projectId, settings) {
      return (await currentToken(projectId, settings)).token;
    },
    invalidate() {
      // Project API tokens are stored directly in DSH Credentials; there is no exchanged-token cache.
    },
    async status(projectIdValue, settingsOverride) {
      const projectId = normalizeProjectId(projectIdValue);
      if (!projectId) return { configured: false, authenticated: false, error: 'A valid GEO projectId is required.' };
      const settings = resolveSettings(settingsOverride);
      if (!configuredProject(settings, projectId)) {
        return { projectId, projectConfigured: false, configured: false, authenticated: false, error: `GEO project ${projectId} is not configured in GEO 工作台.` };
      }
      const ref = credentialRef(projectCredentialRefs(projectId).apiToken);
      let credentialInfo;
      try {
        credentialInfo = await credentials?.describe?.(ref);
      } catch {
        return { projectId, projectConfigured: true, configured: false, authenticated: false, error: 'DSH project credential status could not be read.' };
      }
      if (!credentialInfo?.configured) {
        return { projectId, projectConfigured: true, configured: false, authenticated: false, error: `GEO project ${projectId} has no project API token saved in DSH Credentials.` };
      }
      try {
        const context = await requestContext(projectId, settings);
        return {
          ...context,
          projectConfigured: true,
          configured: true,
          authenticated: true,
          tokenValueExposed: false,
        };
      } catch (error) {
        return {
          projectId,
          projectConfigured: true,
          configured: true,
          authenticated: false,
          error: errorMessage(error),
          tokenValueExposed: false,
        };
      }
    },
  };
}

export async function executeWithGeoProjectToken(auth, projectId, request, settings) {
  let token;
  try {
    token = await auth.getAccessToken(projectId, settings);
  } catch (error) {
    return { ok: false, outcome: 'rejected', error: errorMessage(error) };
  }
  // Never replay an operation automatically after an authentication failure.
  return request(token);
}
