import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { normalizeBasePath, resolveApiOrigin } from './api-client.js';
import { normalizeProjectId, projectCredentialRefs } from './project-context.js';

const maxAuthResponseBytes = 32 * 1024;

function configuredProject(settings, projectId) {
  return settings?.projects?.find(project => normalizeProjectId(project?.projectId) === projectId);
}

/** 令牌校验失败时说清是凭据问题、权限问题还是服务问题，不要只丢一个状态码。 */
function responseError(status) {
  if (status === 401) return 'GEO 拒绝了这个项目的访问令牌：令牌可能已过期、已被撤销，或内容不对。请重新创建并粘贴新令牌。';
  if (status === 403) return 'GEO 拒绝了这个项目的访问令牌：它与所选项目不匹配，或缺少这次操作需要的权限。';
  if (status === 429) return 'GEO 的令牌校验暂时受限流影响，稍后再检查连接。';
  if (status >= 500) return 'GEO 的令牌校验服务暂时不可用，稍后再试。';
  return '令牌校验没有通过。请核对项目的访问令牌与项目配置。';
}

function validateToken(value, projectId, tokenPrefix) {
  const tokenBody = typeof value === 'string' && value.startsWith(tokenPrefix)
    ? value.slice(tokenPrefix.length)
    : '';
  if (!/^[A-Za-z0-9_-]{32,200}$/.test(tokenBody)) {
    throw new Error(`DSH 凭据里为项目 ${projectId} 保存的访问令牌格式无效，请重新粘贴为该项目建设的新令牌。`);
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : '令牌校验没有通过。';
}

async function readBoundedJson(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxAuthResponseBytes) {
    throw new Error('令牌校验返回的内容超过安全上限，已停止读取。');
  }
  let text;
  try {
    text = await response.text();
  } catch {
    throw new Error('令牌校验返回的内容读不出来。');
  }
  if (Buffer.byteLength(text, 'utf8') > maxAuthResponseBytes) {
    throw new Error('令牌校验返回的内容超过安全上限，已停止读取。');
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
  const resolveSettings = settings => settings ?? getSettings?.() ?? { baseUrl, basePath: '', timeoutMs, projects };

  async function resolveToken(projectId) {
    if (typeof credentials?.resolve !== 'function') return undefined;
    const ref = credentialRef(projectCredentialRefs(projectId).apiToken);
    const entry = await credentials.resolve(ref);
    if (typeof entry?.value !== 'string' || entry.value.length === 0) return undefined;
    return validateToken(entry.value, projectId, tokenPrefix);
  }

  function endpointFor(settings, projectId) {
    if (!configuredProject(settings, projectId)) {
      throw new Error(`项目 ${projectId} 还没有在 GEO 工作台里登记。请先在设置卡里添加这个项目。`);
    }
    let origin;
    try {
      origin = resolveApiOrigin(settings?.baseUrl);
    } catch {
      throw new Error('请先在 GEO 工作台里填好有效的服务地址，才能使用项目令牌。');
    }
    const url = new URL(origin);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new Error('项目令牌要求使用 HTTPS 地址；内网 IP 也必须套上 HTTPS。');
    }
    // 与业务调用使用同一个转发前缀——令牌校验本身也走网关路由。
    const servicePath = `${normalizeBasePath(settings?.basePath)}${String(serverPath || '/geo').replace(/\/$/, '')}/auth/project-token-context`;
    return { origin, url: new URL(servicePath, `${origin}/`) };
  }

  async function currentToken(projectIdValue, settingsOverride) {
    const projectId = normalizeProjectId(projectIdValue);
    if (!projectId) throw new Error('要先有一个有效的项目编号，才能取用该项目的凭据。');
    const settings = resolveSettings(settingsOverride);
    endpointFor(settings, projectId);
    let token;
    try {
      token = await resolveToken(projectId);
    } catch (error) {
      throw new Error(errorMessage(error));
    }
    if (!token) {
      throw new Error(`项目 ${projectId} 还没有配置访问令牌。请把为该项目建设、并粘贴进 DSH 凭据里的令牌补齐。`);
    }
    return { projectId, token };
  }

  async function requestContext(projectIdValue, settingsOverride) {
    const projectId = normalizeProjectId(projectIdValue);
    if (!projectId) throw new Error('要先有一个有效的项目编号，才能取用该项目的凭据。');
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
      throw new Error('连不上配置的 GEO 服务，令牌校验没有完成。请检查服务地址与网络。');
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Error('GEO 返回了跳转。为免令牌被带到别的地址，插件没有跟随跳转。');
    }
    const envelope = await readBoundedJson(response);
    const data = envelope?.data;
    if (!response.ok || envelope?.code !== 200 || !data || typeof data !== 'object') {
      throw new Error(responseError(response.status));
    }
    const boundProjectId = normalizeProjectId(data.projectId);
    if (boundProjectId !== projectId) {
      throw new Error(`这个令牌实际绑定的项目是 ${boundProjectId ?? '未知'}，不是当前项目 ${projectId}。请换成属于该项目的令牌。`);
    }
    if (!Array.isArray(data.scopes) || typeof data.expiresAt !== 'string') {
      throw new Error('GEO 返回的令牌信息不完整：缺少权限清单或有效期。');
    }
    const expiresAt = new Date(data.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error('GEO 返回的令牌有效期无法识别。');
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
      // 项目令牌直接存在 DSH 凭据里，没有换票缓存需要清。
    },
    async status(projectIdValue, settingsOverride) {
      const projectId = normalizeProjectId(projectIdValue);
      if (!projectId) return { configured: false, authenticated: false, error: '要先有一个有效的项目编号。' };
      const settings = resolveSettings(settingsOverride);
      if (!configuredProject(settings, projectId)) {
        return { projectId, projectConfigured: false, configured: false, authenticated: false, error: `项目 ${projectId} 还没有在 GEO 工作台里登记。请先在设置卡里添加这个项目。` };
      }
      const ref = credentialRef(projectCredentialRefs(projectId).apiToken);
      let credentialInfo;
      try {
        credentialInfo = await credentials?.describe?.(ref);
      } catch {
        return { projectId, projectConfigured: true, configured: false, authenticated: false, error: '读不到 DSH 里保存的凭据状态。' };
      }
      if (!credentialInfo?.configured) {
        return { projectId, projectConfigured: true, configured: false, authenticated: false, error: `项目 ${projectId} 还没有在 DSH 凭据里保存访问令牌。` };
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
  // 认证失败之后永远不自动重放这次调用。
  return request(token);
}