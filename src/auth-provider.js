import { createHash } from 'node:crypto';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { resolveApiOrigin } from './api-client.js';

export const machineClientIdRef = credentialRef('GEO_MACHINE_CLIENT_ID');
export const machineClientSecretRef = credentialRef('GEO_MACHINE_CLIENT_SECRET');

const maxAuthResponseBytes = 32 * 1024;
const maxTokenLifetimeSeconds = 30 * 60;

function secretFingerprint(clientId, clientSecret) {
  return createHash('sha256').update(clientId).update('\0').update(clientSecret).digest('hex');
}

function responseError(status) {
  if (status === 401 || status === 403 || status === 400) return 'GEO machine credentials were rejected, disabled, or are not bound to an active GEO service account.';
  if (status === 429) return 'GEO authentication is rate limited. Wait before making another request.';
  if (status >= 500) return 'GEO authentication service is unavailable. No GEO business request was sent.';
  return 'GEO authentication failed. Check the machine client configuration.';
}

export function createGeoAuthProvider({ credentials, baseUrl, fetchImpl = fetch, timeoutMs = 30_000, now = Date.now }) {
  let cachedToken;
  const exchanges = new Map();

  async function resolveCredentials() {
    if (typeof credentials?.resolve !== 'function') return undefined;
    const [clientId, clientSecret] = await Promise.all([
      credentials.resolve(machineClientIdRef),
      credentials.resolve(machineClientSecretRef),
    ]);
    if (typeof clientId?.value !== 'string' || clientId.value.trim() === ''
      || typeof clientSecret?.value !== 'string' || clientSecret.value.trim() === '') return undefined;
    return { clientId: clientId.value.trim(), clientSecret: clientSecret.value, fingerprint: secretFingerprint(clientId.value.trim(), clientSecret.value) };
  }

  async function exchange(secret) {
    let origin;
    try { origin = resolveApiOrigin(baseUrl); }
    catch { throw new Error('GEO_API_BASE_URL must be configured as an HTTPS origin before machine authentication.'); }
    if (new URL(origin).protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
      throw new Error('GEO machine authentication requires HTTPS outside localhost.');
    }

    let response;
    try {
      response = await fetchImpl(new URL('/auth/machine-token', `${origin}/`), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: secret.clientId, client_secret: secret.clientSecret }),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
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
    cachedToken = {
      value: token,
      fingerprint: secret.fingerprint,
      clientId: secret.clientId,
      expiresAt: now() + expiresIn * 1000,
      principal: {
        username: typeof data?.principal?.username === 'string' ? data.principal.username : undefined,
        tenantId: typeof data?.principal?.tenant_id === 'string' ? data.principal.tenant_id : undefined,
      },
    };
    return cachedToken;
  }

  async function currentToken() {
    let secret;
    try { secret = await resolveCredentials(); }
    catch { throw new Error('DSH GEO machine credentials could not be read. Check the isolated profile Credentials settings.'); }
    if (!secret) {
      cachedToken = undefined;
      throw new Error('GEO machine credentials are not configured. Add GEO_MACHINE_CLIENT_ID and GEO_MACHINE_CLIENT_SECRET in the isolated DSH profile.');
    }
    const remainingMs = cachedToken?.expiresAt - now();
    const refreshSkewMs = cachedToken ? Math.min(30_000, Math.max(1_000, (cachedToken.expiresAt - now()) * 0.1)) : 0;
    if (cachedToken?.fingerprint === secret.fingerprint && remainingMs > refreshSkewMs) return cachedToken;

    let pending = exchanges.get(secret.fingerprint);
    if (!pending) {
      pending = exchange(secret).finally(() => exchanges.delete(secret.fingerprint));
      exchanges.set(secret.fingerprint, pending);
    }
    return pending;
  }

  return {
    async getAccessToken() {
      return (await currentToken()).value;
    },
    invalidate(token) {
      if (cachedToken?.value === token) cachedToken = undefined;
    },
    async status() {
      let idInfo;
      let secretInfo;
      try {
        [idInfo, secretInfo] = await Promise.all([
          credentials?.describe?.(machineClientIdRef),
          credentials?.describe?.(machineClientSecretRef),
        ]);
      } catch {
        return { configured: false, authenticated: false, error: 'DSH credentials could not be described.' };
      }
      const configured = Boolean(idInfo?.configured && secretInfo?.configured);
      if (!configured) return { configured: false, authenticated: false, error: 'Set both machine client credentials in the isolated DSH profile.' };
      try {
        const token = await currentToken();
        return {
          configured: true,
          authenticated: true,
          clientId: token.clientId,
          principal: token.principal,
          expiresAt: new Date(token.expiresAt).toISOString(),
          tokenValueExposed: false,
        };
      } catch (error) {
        return { configured: true, authenticated: false, error: error.message, tokenValueExposed: false };
      }
    },
  };
}

export async function executeWithGeoMachineToken(auth, request) {
  let token;
  try { token = await auth.getAccessToken(); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }
  const result = await request(token);
  if (result?.status === 401) auth.invalidate(token);
  return result;
}
