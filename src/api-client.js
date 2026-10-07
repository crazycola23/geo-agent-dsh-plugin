import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath, readdir } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { isPlainObject, validateOperationArgs, validateValue } from './schema.js';

const maxBodyBytes = 2 * 1024 * 1024;
const maxResultChars = 48_000;
const maxArrayItems = 60;
const maxStringChars = 8_000;
const idempotencyNamespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
const evidenceMimeTypes = new Map([
  ['.doc', 'application/msword'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function isSupportedEvidenceName(filename) {
  return typeof filename === 'string'
    && filename.length > 0
    && filename.length <= 255
    && basename(filename) === filename
    && !['.', '..'].includes(filename)
    && !/[\\/:\u0000-\u001f\u007f]/.test(filename)
    && evidenceMimeTypes.has(extname(filename).toLowerCase());
}

/** 打开投递目录里的一个资料文件；任何一步不合规都直接拒绝，不发出任何请求。 */
async function openStagedEvidence(evidenceDirectory, filename) {
  if (typeof evidenceDirectory !== 'string' || evidenceDirectory.trim() === '') {
    throw new Error('还没有配置资料投递目录（GEO_EVIDENCE_DIRECTORY）。');
  }
  if (!isSupportedEvidenceName(filename)) {
    throw new Error('文件名必须是投递目录下的单个文件，且扩展名为 .doc、.docx、.pdf 或 .txt。');
  }

  const root = await realpath(evidenceDirectory);
  const candidate = resolve(root, filename);
  if (dirname(candidate) !== root) throw new Error('资料文件必须直接放在已配置的投递目录里，不能带子目录。');

  const before = await lstat(candidate);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('资料文件必须是普通文件，不能是快捷方式或链接。');
  const canonical = await realpath(candidate);
  if (dirname(canonical) !== root) throw new Error('资料文件实际指向了投递目录之外的路径，已拒绝读取。');

  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0);
  const handle = await open(canonical, flags);
  try {
    const opened = await handle.stat();
    const after = await lstat(candidate);
    if (!opened.isFile() || after.isSymbolicLink() || !after.isFile()) {
      throw new Error('资料文件在打开过程中发生了变化，已停止读取。');
    }
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) {
      throw new Error('资料文件在打开过程中发生了变化，已停止读取。');
    }
    return { handle, size: opened.size };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function multipartField(boundary, key, value) {
  return Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`, 'utf8');
}

function multipartStream({ boundary, projectId, name, filename, handle }) {
  const mimeType = evidenceMimeTypes.get(extname(filename).toLowerCase());
  const safeFilename = filename.replace(/["\\\r\n\u0000]/g, '_');
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFilename}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
    'utf8',
  );
  const prefix = [multipartField(boundary, 'projectId', projectId)];
  if (name !== undefined) prefix.push(multipartField(boundary, 'name', name));
  prefix.push(fileHeader);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const fileStream = handle.createReadStream({ autoClose: false, start: 0 });
  const nodeStream = Readable.from((async function* streamParts() {
    for (const part of prefix) yield part;
    for await (const chunk of fileStream) yield chunk;
    yield suffix;
  })());
  return Readable.toWeb(nodeStream);
}

async function hashStagedFile(handle) {
  const hash = createHash('sha256');
  const stream = handle.createReadStream({ autoClose: false, start: 0 });
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

function deterministicUploadKey(projectId, contentDigest) {
  const bytes = createHash('sha1')
    .update(idempotencyNamespace)
    .update(`${projectId}:${contentDigest}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function listStagedEvidenceFiles(evidenceDirectory) {
  if (typeof evidenceDirectory !== 'string' || evidenceDirectory.trim() === '') {
    return { ok: false, error: '还没有配置资料投递目录（GEO_EVIDENCE_DIRECTORY）。', files: [] };
  }
  try {
    const root = await realpath(evidenceDirectory);
    const entries = await readdir(root, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isSupportedEvidenceName(entry.name)) continue;
      const path = resolve(root, entry.name);
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) continue;
      files.push({ fileName: entry.name, bytes: metadata.size });
    }
    files.sort((left, right) => left.fileName.localeCompare(right.fileName));
    return { ok: true, files, count: files.length };
  } catch {
    return { ok: false, error: '配置的资料投递目录当前读不到，请检查路径是否存在、是否有读取权限。', files: [] };
  }
}

export function resolveApiOrigin(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') throw new Error('还没有配置 GEO 服务地址（GEO_API_BASE_URL）。');
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('GEO 服务地址只能填协议、主机和端口，不要带用户名、路径、查询参数或片段。');
  }
  return url.origin;
}

/**
 * 归一化可选的转发路径前缀。只接受一段普通的绝对路径，这样配置值永远不会变成
 * 另一个主机、不会覆盖授权信息、也不会变成协议相对的跳转而把令牌泄露到别处。
 */
export function normalizeBasePath(basePath) {
  if (typeof basePath !== 'string') return '';
  const trimmed = basePath.trim();
  if (trimmed === '' || trimmed === '/') return '';
  if (!trimmed.startsWith('/')) throw new Error('转发路径前缀要以 / 开头，例如 /prod-api。');
  if (trimmed.includes('//') || trimmed.includes('\\') || trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error('转发路径前缀只能是一段路径，不要带查询参数、片段或反斜杠。');
  }
  return trimmed.replace(/\/+$/, '');
}

function encodeQueryValue(value) {
  if (value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildUrl(operation, args, origin, serverPath, basePath = '') {
  const pathParams = args.pathParams ?? {};
  let route = operation.path.replace(/\{([^}]+)\}/g, (_whole, name) => {
    if (!Object.hasOwn(pathParams, name)) throw new Error(`pathParams.${name}：是必填项，请补上`);
    return encodeURIComponent(String(pathParams[name]));
  });
  if (/[{}]/.test(route)) throw new Error('地址里的占位参数没有全部替换掉，无法发出请求。');
  // 前缀与接口路径这两半都是可选的。`new URL(route, origin)` 会保留路径开头的斜杠，
  // 所以前缀不会被吞掉。
  route = `${basePath}${serverPath.replace(/\/$/, '')}${route}`;
  const url = new URL(route, `${origin}/`);
  const definitions = new Map(operation.parameters.filter(param => param.in === 'query').map(param => [param.name, param]));
  for (const [key, value] of Object.entries(args.query ?? {})) {
    const definition = definitions.get(key);
    if (Array.isArray(value) && definition?.explode === false) url.searchParams.set(key, value.map(encodeQueryValue).join(','));
    else if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, encodeQueryValue(item));
    else url.searchParams.set(key, encodeQueryValue(value));
  }
  return url;
}

function bounded(value, state = { truncated: false }, depth = 0) {
  if (typeof value === 'string') {
    if (value.length <= maxStringChars) return value;
    state.truncated = true;
    return `${value.slice(0, maxStringChars)}…`;
  }
  if (Array.isArray(value)) {
    const sliced = value.slice(0, maxArrayItems).map(item => bounded(item, state, depth + 1));
    if (sliced.length !== value.length) state.truncated = true;
    return sliced;
  }
  if (!isPlainObject(value)) return value;
  if (depth >= 12) {
    state.truncated = true;
    return '[层级过深，已省略]';
  }
  const entries = Object.entries(value).slice(0, 120).map(([key, item]) => [key, bounded(item, state, depth + 1)]);
  if (entries.length !== Object.keys(value).length) state.truncated = true;
  return Object.fromEntries(entries);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    /^(?:accessToken|refreshToken|apiKey|token|authorization|password|secret|cookie)$/i.test(key)
      ? '[已隐去]'
      : redact(child),
  ]));
}

function smallDetails(value) {
  if (!isPlainObject(value)) return value;
  const allowed = ['code', 'msg', 'bizCode', 'requestId', 'details', 'warnings'];
  return redact(Object.fromEntries(allowed.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]])));
}

async function readJsonLimited(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw new Error('GEO 返回的内容超过 2 MiB 安全上限，已停止读取；先确认这次读取是否已经完成，再缩小范围重试。');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function requestTimeoutSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * DSH 的桥接层会把类型为 json 的工具参数以 JSON 字符串形式送进来，而进程内调用方
 * （测试、内嵌智能体）直接传对象。两种形状都接受，保证严格的契约校验看到的始终
 * 是解析后的值；格式不对的 JSON 文本在派发之前就被拒绝。
 */
function coerceJsonArgs(args) {
  const out = { ...args };
  for (const key of ['pathParams', 'query', 'headers', 'body']) {
    const value = out[key];
    if (value === undefined || typeof value !== 'string') continue;
    try {
      out[key] = JSON.parse(value);
    } catch {
      return { error: `${key}：不是合法的 JSON 文本` };
    }
  }
  return { value: out };
}

export async function executeGeoOperation({ catalog, operationName, args, baseUrl, basePath = '', token, signal, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const operation = catalog.operations[operationName];
  if (!operation) return { ok: false, outcome: 'rejected', error: `操作名 ${operationName} 不在本插件已开放的操作清单里。` };
  if (operation.requestBody?.contentType && operation.requestBody.contentType !== 'application/json') {
    return { ok: false, outcome: 'rejected', error: '这个操作要用它专用的受限工具；上传 GEO 资料请用 geo_upload_evidence。' };
  }
  if (!isPlainObject(args)) return { ok: false, outcome: 'rejected', error: '工具参数必须是一个对象。' };
  const jsonArgs = coerceJsonArgs(args);
  if (jsonArgs.error) {
    return { ok: false, outcome: 'rejected', error: '请求不符合 GEO 接口契约，已被拦下', validationErrors: [jsonArgs.error] };
  }
  args = jsonArgs.value;
  const idemParam = operation.parameters.find(param => param.in === 'header' && param.name.toLowerCase() === 'x-idempotency-key');
  if (args.idempotencyKey !== undefined && !idemParam) {
    return { ok: false, outcome: 'rejected', error: '这个操作没有 X-Idempotency-Key 参数，不需要传幂等键。' };
  }
  const idempotencyKey = idemParam ? (args.idempotencyKey || randomUUID()) : undefined;
  const idempotencyHeaders = idemParam ? { [idemParam.name]: idempotencyKey } : {};
  const normalizedArgs = { ...args, headers: idempotencyHeaders };
  const validationErrors = validateOperationArgs(operation, normalizedArgs, catalog);
  if (validationErrors.length) return { ok: false, outcome: 'rejected', error: '请求不符合 GEO 接口契约，已被拦下', validationErrors };
  if (typeof token !== 'string' || token.trim() === '') return { ok: false, outcome: 'rejected', error: '这个项目还没有配置访问令牌。' };

  let origin;
  try { origin = resolveApiOrigin(baseUrl); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }
  let gatewayPrefix;
  try { gatewayPrefix = normalizeBasePath(basePath); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }

  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Accept-Language': 'zh_CN',
  });
  for (const [name, value] of Object.entries(normalizedArgs.headers)) headers.set(name, String(value));

  const request = { method: operation.method, headers, redirect: 'manual', signal: requestTimeoutSignal(signal, timeoutMs) };
  if (normalizedArgs.body !== undefined) {
    const body = JSON.stringify(normalizedArgs.body);
    if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) return { ok: false, outcome: 'rejected', error: '请求内容超过 2 MiB 安全上限，已拒绝发出。' };
    headers.set('Content-Type', 'application/json');
    request.body = body;
  }

  const url = buildUrl(operation, normalizedArgs, origin, catalog.serverPath, gatewayPrefix);
  let response;
  try {
    response = await fetchImpl(url, request);
  } catch {
    return {
      ok: false,
      outcome: 'unknown',
      operation: operation.name,
      method: operation.method,
      idempotencyKey,
      error: 'GEO 没有返回任何响应，这次请求可能已经被受理。请先查对应的 GEO 记录，确认结果之后再考虑是否重试。',
    };
  }

  const contentType = response.headers.get('content-type') || 'unknown';
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, outcome: 'rejected', operation: operation.name, status: response.status, idempotencyKey, error: 'GEO 返回了跳转。为免把凭据带到别的地址，插件没有跟随跳转。' };
  }

  if (operation.method !== 'GET' && response.status >= 500) {
    return {
      ok: false,
      outcome: 'unknown',
      operation: operation.name,
      method: operation.method,
      status: response.status,
      idempotencyKey,
      error: '写入请求发出后，GEO 返回了服务端错误。请先核对对应的 GEO 记录；如果这个操作定义了幂等键，就用原来那个键恢复。插件不会自动重试。',
    };
  }

  let text;
  try { text = await readJsonLimited(response); }
  catch (error) {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, idempotencyKey, error: error.message };
  }

  if (!contentType.toLowerCase().includes('json')) {
    return {
      ok: response.ok,
      outcome: response.ok ? 'complete' : 'rejected',
      operation: operation.name,
      status: response.status,
      contentType,
      contentBytes: Buffer.byteLength(text, 'utf8'),
      bodyOmitted: true,
      idempotencyKey,
      note: '返回的是网页或二进制内容，正文已省略；请到对应的 GEO 页面查看。',
    };
  }

  let envelope;
  try { envelope = JSON.parse(text); }
  catch {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, idempotencyKey, error: 'GEO 返回的内容不是合法 JSON。重复写入之前，请先查对应的 GEO 记录。' };
  }

  const successCode = envelope?.code === undefined || envelope.code === 200;
  const ok = response.ok && successCode;
  const data = redact(envelope?.data ?? envelope);
  const boundedState = { truncated: false };
  const safeData = bounded(data, boundedState);
  let result = {
    ok,
    outcome: ok ? 'complete' : 'rejected',
    operation: operation.name,
    status: response.status,
    ...smallDetails(envelope),
    data: safeData,
    idempotencyKey,
  };
  if (boundedState.truncated) {
    result.truncated = true;
    result.note = '返回内容过大，已做截断以适配对话；要看剩余记录请用分页或更精确的筛选条件。';
  }
  if (JSON.stringify(result).length > maxResultChars) {
    result = {
      ok,
      outcome: ok ? 'complete' : 'rejected',
      operation: operation.name,
      status: response.status,
      requestId: envelope?.requestId,
      bizCode: envelope?.bizCode,
      idempotencyKey,
      dataOmitted: true,
      note: '截断之后返回内容仍然过大，本次数据已整体省略；请用分页或更精确的筛选条件重新查询。',
    };
  }
  return result;
}

export async function executeGeoEvidenceUpload({ catalog, args, evidenceDirectory, baseUrl, basePath = '', token, signal, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const operation = catalog.operations.post_evidence_sources_upload;
  if (!operation || operation.method !== 'POST' || operation.path !== '/evidence-sources/upload'
      || operation.requestBody?.contentType !== 'multipart/form-data') {
    return { ok: false, outcome: 'rejected', error: '生成的操作清单里没有找到资料上传接口，无法上传。' };
  }
  if (!isPlainObject(args)) return { ok: false, outcome: 'rejected', error: '工具参数必须是一个对象。' };
  const allowedArgs = new Set(['projectId', 'fileName', 'name', 'idempotencyKey']);
  const unknown = Object.keys(args).filter(key => !allowedArgs.has(key));
  if (unknown.length) return { ok: false, outcome: 'rejected', error: `上传工具不认识的参数：${unknown.join('、')}` };
  const projectId = String(args.projectId ?? '');
  if (!/^[1-9]\d*$/.test(projectId)) return { ok: false, outcome: 'rejected', error: '项目编号必须是有效的 GEO 项目编号：正整数' };
  if (args.name !== undefined && (typeof args.name !== 'string' || args.name.length < 1 || args.name.length > 300 || /[\u0000-\u001f\u007f]/.test(args.name))) {
    return { ok: false, outcome: 'rejected', error: '资料名称必须是 1 到 300 个字符的文本，且不能包含控制字符。' };
  }

  const uploadBody = { projectId, file: args.fileName, ...(args.name === undefined ? {} : { name: args.name }) };
  const validationErrors = validateValue(uploadBody, operation.requestBody.schema, 'body', catalog.schemas);
  if (validationErrors.length) return { ok: false, outcome: 'rejected', error: '上传字段不符合 GEO 接口契约，已被拦下', validationErrors };
  const idemParam = operation.parameters.find(param => param.in === 'header' && param.name.toLowerCase() === 'x-idempotency-key');
  if (!idemParam) return { ok: false, outcome: 'rejected', error: '生成的上传接口定义里缺少 X-Idempotency-Key，无法安全上传。' };
  if (args.idempotencyKey !== undefined) {
    if (typeof args.idempotencyKey !== 'string' || args.idempotencyKey.length < 1 || args.idempotencyKey.length > 200) {
      return { ok: false, outcome: 'rejected', error: '幂等键必须是 1 到 200 个字符的文本。' };
    }
    const keyErrors = validateValue(args.idempotencyKey, idemParam.schema, 'headers.X-Idempotency-Key', catalog.schemas);
    if (keyErrors.length) return { ok: false, outcome: 'rejected', error: '幂等键不符合 GEO 接口契约', validationErrors: keyErrors };
  }
  if (typeof token !== 'string' || token.trim() === '') return { ok: false, outcome: 'rejected', error: '这个项目还没有配置访问令牌。' };

  let origin;
  try { origin = resolveApiOrigin(baseUrl); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }
  let gatewayPrefix;
  try { gatewayPrefix = normalizeBasePath(basePath); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }

  let opened;
  try { opened = await openStagedEvidence(evidenceDirectory, args.fileName); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }

  let contentDigest;
  try { contentDigest = await hashStagedFile(opened.handle); }
  catch {
    await opened.handle.close().catch(() => {});
    return { ok: false, outcome: 'rejected', error: '读不了投递目录里的资料文件，没有向 GEO 发出任何请求。' };
  }
  const idempotencyKey = args.idempotencyKey || deterministicUploadKey(projectId, contentDigest);
  const keyErrors = validateValue(idempotencyKey, idemParam.schema, 'headers.X-Idempotency-Key', catalog.schemas);
  if (keyErrors.length) {
    await opened.handle.close().catch(() => {});
    return { ok: false, outcome: 'rejected', error: '自动生成的幂等键不符合 GEO 接口契约', validationErrors: keyErrors };
  }

  const boundary = `----geo-${randomUUID().replaceAll('-', '')}`;
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Accept-Language': 'zh_CN',
    [idemParam.name]: idempotencyKey,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  });
  const url = new URL(`${gatewayPrefix}${catalog.serverPath.replace(/\/$/, '')}${operation.path}`, `${origin}/`);
  const request = {
    method: operation.method,
    headers,
    body: multipartStream({ boundary, projectId, name: args.name, filename: args.fileName, handle: opened.handle }),
    duplex: 'half',
    redirect: 'manual',
    signal: requestTimeoutSignal(signal, timeoutMs),
  };

  let response;
  try {
    response = await fetchImpl(url, request);
  } catch {
    await opened.handle.close().catch(() => {});
    return {
      ok: false,
      outcome: 'unknown',
      operation: operation.name,
      method: operation.method,
      fileName: args.fileName,
      projectId,
      idempotencyKey,
      error: 'GEO 没有返回任何响应，这次上传可能已经被受理。请先查这个项目的资料列表；如果规则允许恢复，就用同一个幂等键重试。',
    };
  }
  await opened.handle.close().catch(() => {});

  const contentType = response.headers.get('content-type') || 'unknown';
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, outcome: 'rejected', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: 'GEO 返回了跳转。为免把凭据带到别的地址，插件没有跟随跳转。' };
  }
  if (response.status >= 500) {
    return { ok: false, outcome: 'unknown', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: '上传请求发出后，GEO 返回了服务端错误。请先查该项目的资料列表再决定；不要直接再提交一次上传。' };
  }

  let text;
  try { text = await readJsonLimited(response); }
  catch (error) {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: error.message };
  }
  if (!contentType.toLowerCase().includes('json')) {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: 'GEO 没有返回预期的资料记录。请先查该项目的资料列表再决定如何处理。' };
  }
  let envelope;
  try { envelope = JSON.parse(text); }
  catch {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: 'GEO 返回的内容不是合法 JSON。重复上传之前，请先查该项目的资料列表。' };
  }
  const ok = response.ok && (envelope?.code === undefined || envelope.code === 200);
  const data = redact(envelope?.data ?? envelope);
  const boundedState = { truncated: false };
  const result = {
    ok,
    outcome: ok ? 'complete' : 'rejected',
    operation: operation.name,
    status: response.status,
    ...smallDetails(envelope),
    data: bounded(data, boundedState),
    fileName: args.fileName,
    projectId,
    idempotencyKey,
  };
  if (boundedState.truncated) result.truncated = true;
  if (JSON.stringify(result).length > maxResultChars) {
    return {
      ok,
      outcome: ok ? 'complete' : 'rejected',
      operation: operation.name,
      status: response.status,
      requestId: envelope?.requestId,
      bizCode: envelope?.bizCode,
      fileName: args.fileName,
      projectId,
      idempotencyKey,
      dataOmitted: true,
      note: '返回内容过大已省略；请到资料列表里查看刚创建的记录。',
    };
  }
  return result;
}

export function isWriteOperation(catalog, operationName) {
  const operation = catalog.operations[operationName];
  return operation ? operation.method !== 'GET' : true;
}

export function describeOperation(operation, schemas) {
  return {
    operation: operation.name,
    method: operation.method,
    route: operation.path,
    category: operation.tag,
    summary: operation.summary,
    permission: operation.permission,
    approval: operation.method === 'GET' ? '不需要审批，只读操作' : '需要审批：派发之前 DSH 会请操作员确认',
    pathParameters: operation.parameters.filter(param => param.in === 'path').map(param => ({ name: param.name, required: param.required, schema: param.schema, description: param.description })),
    queryParameters: operation.parameters.filter(param => param.in === 'query').map(param => ({ name: param.name, required: param.required, schema: param.schema, description: param.description })),
    headers: operation.parameters.filter(param => param.in === 'header').map(param => ({
      name: param.name,
      required: param.required || param.name.toLowerCase() === 'x-idempotency-key',
      schema: param.schema,
      description: param.name.toLowerCase() === 'x-idempotency-key' && operation.idempotencyRule
        ? operation.idempotencyRule
        : param.description,
    })),
    body: operation.requestBody?.schema ? {
      required: operation.requestBody.required,
      contentType: operation.requestBody.contentType,
      schema: operation.requestBody.schema,
    } : null,
    idempotencyRule: operation.idempotencyRule,
    response: operation.hasJsonResponse ? 'GEO 标准返回结构（JSON）' : '非 JSON 返回，只做摘要，正文省略',
    schemas,
  };
}