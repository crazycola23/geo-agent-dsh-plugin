import { createHash } from 'node:crypto';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { resolveApiOrigin } from './api-client.js';
import { normalizeProjectId, projectCredentialRefs } from './project-context.js';

const maxAuthResponseBytes = 32 * 1024;
const maxTokenLifetimeSeconds = 30 * 60;

function secretFingerprint(clientId, clientSecret) {
  return createHash('sha256').update(clientId).update('\0').update(clientSecret).digest('hex');
}

function responseError(status) {
  if (status === 401 || status === 403 || status === 400) return 'GEO machine credentials were rejected, disabled, or are not bound to an active GEO service account.';
  if (status === 429) return 'GEO authentication is rate limited. Wait before making another request.';
  if (status >= 500) return 'GEO authentication service is unavailable. No GEO business request was sent.';
  return 'GEO authentication failed. Check this project’s machine client configuration.';
}

function configuredProject(settings, projectId) {
  return settings?.projects?.find(project => normalizeProjectId(project?.projectId) === projectId);
}

export function createGeoAuthProvider({ credentials, baseUrl, timeoutMs = 30_000, projects, getSettings, fetchImpl = fetch, now = Date.now }) {
  const cachedTokens = new Map();
  const exchanges = new Map();
  const resolveSettings = (settings) => settings ?? getSettings?.() ?? { baseUrl, timeoutMs, projects };

  async function resolveCredentials(projectId) {
    if (typeof credentials?.resolve !== 'function') return undefined;
    const refs = projectCredentialRefs(projectId);
    const [clientId, clientSecret] = await Promise.all([
      credentials.resolve(credentialRef(refs.clientId)),
      credentials.resolve(credentialRef(refs.clientSecret)),
    ]);
    if (typeof clientId?.value !== 'string' || clientId.value.trim() === ''
      || typeof clientSecret?.value !== 'string' || clientSecret.value.trim() === '') return undefined;
    const normalizedClientId = clientId.value.trim();
    return {
      clientId: normalizedClientId,
      clientSecret: clientSecret.value,
      fingerprint: secretFingerprint(normalizedClientId, clientSecret.value),
    };
  }

  async function assertProjectClientIsUnique(projectId, clientId, settings) {
    const otherProjectIds = new Set((settings?.projects ?? [])
      .map(project => normalizeProjectId(project?.projectId))
      .filter(candidate => candidate && candidate !== projectId));
    for (const otherProjectId of otherProjectIds) {
      let otherClient;
      try {
        otherClient = await credentials.resolve(credentialRef(projectCredentialRefs(otherProjectId).clientId));
      } catch {
        throw new Error(`DSH 无法核验 GEO 项目 ${otherProjectId} 的 Client ID 是否独立；请检查项目凭据配置。`);
      }
      const otherClientId = typeof otherClient?.value === 'string' ? otherClient.value.trim() : '';
      if (otherClientId && otherClientId === clientId) {
        throw new Error(`GEO 项目 ${projectId} 与项目 ${otherProjectId} 配置了相同 Client ID；每个项目必须使用独立机器客户端。`);
      }
    }
  }

  async function exchange(secret, settings, origin, projectId) {
    const authTimeoutMs = Number.isFinite(settings?.timeoutMs) ? settings.timeoutMs : timeoutMs;
    const endpoint = new URL('/auth/machine-token', `${origin}/`);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: secret.clientId, client_secret: secret.clientSecret }),
        redirect: 'manual',
        signal: AbortSignal.timeout(authTimeoutMs),
      });
    } catch {
      throw new Error('GEO authentication service could not be reached. No GEO business request was sent.');
    }

    if (response.status >= 300 && response.status < 400) {
      throw new Error('GEO authentication returned a redirect. It was not followed to protect machine credentials.');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxAuthResponseBytes) {
      throw new Error('GEO authentication response exceeded the safety limit.');
    }
    let text;
    try { text = await response.text(); }
    catch { throw new Error('GEO authentication returned an unreadable response.'); }
    if (Buffer.byteLength(text, 'utf8') > maxAuthResponseBytes) throw new Error('GEO authentication response exceeded the safety limit.');

    let envelope;
    try { envelope = JSON.parse(text); }
    catch { throw new Error(responseError(response.status)); }
    const data = envelope?.data;
    const token = data?.access_token;
    const expiresIn = Number(data?.expires_in);
    if (!response.ok || envelope?.code !== 200 || typeof token !== 'string' || token.trim() === '') {
      throw new Error(responseError(response.status));
    }
    if (!Number.isFinite(expiresIn) || expiresIn < 1 || expiresIn > maxTokenLifetimeSeconds) {
      throw new Error('GEO authentication returned an invalid token lifetime.');
    }
    if (data?.client_id !== secret.clientId || data?.token_type?.toLowerCase() !== 'bearer') {
      throw new Error('GEO authentication response did not match the configured machine client.');
    }
    return {
      value: token,
      fingerprint: secret.fingerprint,
      projectId,
      clientId: secret.clientId,
      expiresAt: now() + expiresIn * 1000,
      principal: {
        username: typeof data?.principal?.username === 'string' ? data.principal.username : undefined,
        tenantId: typeof data?.principal?.tenant_id === 'string' ? data.principal.tenant_id : undefined,
      },
    };
  }

  async function currentToken(projectIdValue, settingsOverride) {
    const projectId = normalizeProjectId(projectIdValue);
    if (!projectId) throw new Error('A valid GEO projectId is required to select project credentials.');
    const settings = resolveSettings(settingsOverride);
    const configuredIds = new Set((settings?.projects ?? []).map(project => normalizeProjectId(project?.projectId)).filter(Boolean));
    for (const cachedProjectId of cachedTokens.keys()) {
      if (!configuredIds.has(cachedProjectId)) cachedTokens.delete(cachedProjectId);
    }
    if (!configuredProject(settings, projectId)) {
      cachedTokens.delete(projectId);
      throw new Error(`GEO project ${projectId} has no machine client configured in GEO 工作台.`);
    }

    let origin;
    try { origin = resolveApiOrigin(settings?.baseUrl); }
    catch { throw new Error('在 GEO 工作台配置一个有效的服务地址后，才能进行机器认证。'); }
    if (new URL(origin).protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
      throw new Error('GEO 机器认证要求使用 HTTPS；内网 IP 地址也必须配置 HTTPS。');
    }

    let secret;
    try { secret = await resolveCredentials(projectId); }
    catch { throw new Error(`DSH 无法读取 GEO 项目 ${projectId} 的机器凭据。`); }
    if (!secret) {
      cachedTokens.delete(projectId);
      throw new Error(`GEO 项目 ${projectId} 的机器凭据未配置。请在 GEO 工作台为该项目填写独立 Client ID 和 Client Secret。`);
    }
    try { await assertProjectClientIsUnique(projectId, secret.clientId, settings); }
    catch (error) {
      cachedTokens.delete(projectId);
      throw error;
    }
    if (secret.clientId.length > 64 || !/^[!-~]{32,72}$/.test(secret.clientSecret)) {
      cachedTokens.delete(projectId);
      throw new Error(`GEO 项目 ${projectId} 的机器凭据格式无效：Client ID 最长 64 个字符，Client Secret 必须为 32–72 位无空格 ASCII 字符。`);
    }

    const fingerprint = createHash('sha256')
      .update(secret.fingerprint)
      .update('\0')
      .update(origin)
      .update('\0')
      .update(projectId)
      .digest('hex');
    secret = { ...secret, fingerprint };
    const cached = cachedTokens.get(projectId);
    const remainingMs = cached?.expiresAt - now();
    const refreshSkewMs = cached ? Math.min(30_000, Math.max(1_000, remainingMs * 0.1)) : 0;
    if (cached?.fingerprint === fingerprint && remainingMs > refreshSkewMs) return cached;
    if (cached) cachedTokens.delete(projectId);

    const exchangeKey = `${projectId}\0${fingerprint}`;
    let pending = exchanges.get(exchangeKey);
    if (!pending) {
      pending = exchange(secret, settings, origin, projectId)
        .then(async token => {
          // Don't retain a token if this project's credentials or origin changed mid-exchange.
          try {
            const latestSettings = resolveSettings();
            const latestOrigin = resolveApiOrigin(latestSettings?.baseUrl);
            const latestSecret = await resolveCredentials(projectId);
            const latestFingerprint = latestSecret && createHash('sha256')
              .update(latestSecret.fingerprint)
              .update('\0')
              .update(latestOrigin)
              .update('\0')
              .update(projectId)
              .digest('hex');
            if (configuredProject(latestSettings, projectId) && latestFingerprint === fingerprint) {
              cachedTokens.set(projectId, token);
            }
          } catch {
            cachedTokens.delete(projectId);
          }
          return token;
        })
        .finally(() => exchanges.delete(exchangeKey));
      exchanges.set(exchangeKey, pending);
    }
    return pending;
  }

  return {
    async getAccessToken(projectId, settings) {
      return (await currentToken(projectId, settings)).value;
    },
    invalidate(projectIdValue, token) {
      const projectId = normalizeProjectId(projectIdValue);
      if (projectId && cachedTokens.get(projectId)?.value === token) cachedTokens.delete(projectId);
    },
    async status(projectIdValue, settingsOverride) {
      const projectId = normalizeProjectId(projectIdValue);
      if (!projectId) return { configured: false, authenticated: false, error: 'A valid GEO projectId is required.' };
      const settings = resolveSettings(settingsOverride);
      if (!configuredProject(settings, projectId)) {
        return { projectId, projectConfigured: false, configured: false, authenticated: false, error: `GEO project ${projectId} is not configured in GEO 工作台.` };
      }

      const refs = projectCredentialRefs(projectId);
      let idInfo;
      let secretInfo;
      try {
        [idInfo, secretInfo] = await Promise.all([
          credentials?.describe?.(credentialRef(refs.clientId)),
          credentials?.describe?.(credentialRef(refs.clientSecret)),
        ]);
      } catch {
        return { projectId, projectConfigured: true, configured: false, authenticated: false, error: 'DSH project credentials could not be described.' };
      }
      const configured = Boolean(idInfo?.configured && secretInfo?.configured);
      if (!configured) {
        cachedTokens.delete(projectId);
        return { projectId, projectConfigured: true, configured: false, authenticated: false, error: `Set both machine client credentials for GEO project ${projectId}.` };
      }
      try {
        const token = await currentToken(projectId, settings);
        return {
          projectId,
          projectConfigured: true,
          configured: true,
          authenticated: true,
          clientId: token.clientId,
          principal: token.principal,
          expiresAt: new Date(token.expiresAt).toISOString(),
          tokenValueExposed: false,
        };
      } catch (error) {
        return { projectId, projectConfigured: true, configured: true, authenticated: false, error: error.message, tokenValueExposed: false };
      }
    },
  };
}

export async function executeWithGeoMachineToken(auth, projectId, request, settings) {
  let token;
  try { token = await auth.getAccessToken(projectId, settings); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }
  const result = await request(token);
  if (result?.status === 401) auth.invalidate(projectId, token);
  return result;
}
