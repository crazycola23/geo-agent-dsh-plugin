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

async function openStagedEvidence(evidenceDirectory, filename) {
  if (typeof evidenceDirectory !== 'string' || evidenceDirectory.trim() === '') {
    throw new Error('GEO_EVIDENCE_DIRECTORY is not configured');
  }
  if (!isSupportedEvidenceName(filename)) {
    throw new Error('fileName must be a direct-child .doc, .docx, .pdf, or .txt file name');
  }

  const root = await realpath(evidenceDirectory);
  const candidate = resolve(root, filename);
  if (dirname(candidate) !== root) throw new Error('Evidence file must be directly inside the configured staging directory');

  const before = await lstat(candidate);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('Evidence file must be a regular file, not a symbolic link');
  const canonical = await realpath(candidate);
  if (dirname(canonical) !== root) throw new Error('Evidence file resolves outside the configured staging directory');

  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW || 0);
  const handle = await open(canonical, flags);
  try {
    const opened = await handle.stat();
    const after = await lstat(candidate);
    if (!opened.isFile() || after.isSymbolicLink() || !after.isFile()) {
      throw new Error('Evidence file changed while it was being opened');
    }
    if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) {
      throw new Error('Evidence file changed while it was being opened');
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
    return { ok: false, error: 'GEO_EVIDENCE_DIRECTORY is not configured', files: [] };
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
    return { ok: false, error: 'The configured GEO staging directory is unavailable', files: [] };
  }
}

export function resolveApiOrigin(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') throw new Error('GEO_API_BASE_URL is not configured');
  const url = new URL(baseUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('GEO_API_BASE_URL must be an http(s) origin without credentials, path, query, or fragment');
  }
  return url.origin;
}

function encodeQueryValue(value) {
  if (value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildUrl(operation, args, origin, serverPath) {
  const pathParams = args.pathParams ?? {};
  let route = operation.path.replace(/\{([^}]+)\}/g, (_whole, name) => {
    if (!Object.hasOwn(pathParams, name)) throw new Error(`pathParams.${name} is required`);
    return encodeURIComponent(String(pathParams[name]));
  });
  if (/[{}]/.test(route)) throw new Error('Path parameters were not fully resolved');
  route = `${serverPath.replace(/\/$/, '')}${route}`;
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
    return '[depth limit]';
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
      ? '[redacted]'
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
      throw new Error('GEO response exceeded the 2 MiB safety limit; narrow the query and retry only after checking whether the read completed');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function requestTimeoutSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function executeGeoOperation({ catalog, operationName, args, baseUrl, token, signal, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const operation = catalog.operations[operationName];
  if (!operation) return { ok: false, outcome: 'rejected', error: `Operation '${operationName}' is not in the generated OpenAPI allowlist` };
  if (operation.requestBody?.contentType && operation.requestBody.contentType !== 'application/json') {
    return { ok: false, outcome: 'rejected', error: 'This operation requires a dedicated constrained tool; use geo_upload_evidence for GEO evidence uploads.' };
  }
  if (!isPlainObject(args)) return { ok: false, outcome: 'rejected', error: 'Tool arguments must be an object' };
  const idemParam = operation.parameters.find(param => param.in === 'header' && param.name.toLowerCase() === 'x-idempotency-key');
  if (args.idempotencyKey !== undefined && !idemParam) {
    return { ok: false, outcome: 'rejected', error: 'This operation has no X-Idempotency-Key parameter' };
  }
  const idempotencyKey = idemParam ? (args.idempotencyKey || randomUUID()) : undefined;
  const idempotencyHeaders = idemParam ? { [idemParam.name]: idempotencyKey } : {};
  const normalizedArgs = { ...args, headers: idempotencyHeaders };
  const validationErrors = validateOperationArgs(operation, normalizedArgs, catalog);
  if (validationErrors.length) return { ok: false, outcome: 'rejected', error: 'Request does not match the canonical GEO OpenAPI contract', validationErrors };
  if (typeof token !== 'string' || token.trim() === '') return { ok: false, outcome: 'rejected', error: 'GEO project API token is not configured for this project.' };

  let origin;
  try { origin = resolveApiOrigin(baseUrl); }
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
    if (Buffer.byteLength(body, 'utf8') > maxBodyBytes) return { ok: false, outcome: 'rejected', error: 'Request body exceeded the 2 MiB safety limit' };
    headers.set('Content-Type', 'application/json');
    request.body = body;
  }

  const url = buildUrl(operation, normalizedArgs, origin, catalog.serverPath);
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
      error: 'GEO did not return a response. The request may already have been accepted; inspect the corresponding GEO record before attempting any repeat.',
    };
  }

  const contentType = response.headers.get('content-type') || 'unknown';
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, outcome: 'rejected', operation: operation.name, status: response.status, idempotencyKey, error: 'GEO returned a redirect. It was not followed to avoid forwarding credentials to another origin.' };
  }

  if (operation.method !== 'GET' && response.status >= 500) {
    return {
      ok: false,
      outcome: 'unknown',
      operation: operation.name,
      method: operation.method,
      status: response.status,
      idempotencyKey,
      error: 'GEO returned an HTTP server error after the write request. Reconcile the corresponding GEO record before repeating, using the original idempotency key when the operation defines one; the plugin will not retry automatically.',
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
      note: 'HTML and binary response bodies are omitted; open the corresponding GEO page to inspect them.',
    };
  }

  let envelope;
  try { envelope = JSON.parse(text); }
  catch {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, idempotencyKey, error: 'GEO returned an invalid JSON response; inspect the GEO record before repeating a write.' };
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
    result.note = 'Large GEO response was reduced for the conversation. Use pagination or a narrower filter to inspect remaining records.';
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
      note: 'GEO response remained too large after bounded projection. Use pagination or a narrower filter.',
    };
  }
  return result;
}

export async function executeGeoEvidenceUpload({ catalog, args, evidenceDirectory, baseUrl, token, signal, fetchImpl = fetch, timeoutMs = 30_000 }) {
  const operation = catalog.operations.post_evidence_sources_upload;
  if (!operation || operation.method !== 'POST' || operation.path !== '/evidence-sources/upload'
      || operation.requestBody?.contentType !== 'multipart/form-data') {
    return { ok: false, outcome: 'rejected', error: 'The generated GEO catalog does not contain the expected evidence upload contract' };
  }
  if (!isPlainObject(args)) return { ok: false, outcome: 'rejected', error: 'Tool arguments must be an object' };
  const allowedArgs = new Set(['projectId', 'fileName', 'name', 'idempotencyKey']);
  const unknown = Object.keys(args).filter(key => !allowedArgs.has(key));
  if (unknown.length) return { ok: false, outcome: 'rejected', error: `Unsupported upload argument(s): ${unknown.join(', ')}` };
  const projectId = String(args.projectId ?? '');
  if (!/^[1-9]\d*$/.test(projectId)) return { ok: false, outcome: 'rejected', error: 'projectId must be a positive GEO project identifier' };
  if (args.name !== undefined && (typeof args.name !== 'string' || args.name.length < 1 || args.name.length > 300 || /[\u0000-\u001f\u007f]/.test(args.name))) {
    return { ok: false, outcome: 'rejected', error: 'name must be a non-empty string of at most 300 characters without control characters' };
  }

  const uploadBody = { projectId, file: args.fileName, ...(args.name === undefined ? {} : { name: args.name }) };
  const validationErrors = validateValue(uploadBody, operation.requestBody.schema, 'body', catalog.schemas);
  if (validationErrors.length) return { ok: false, outcome: 'rejected', error: 'Upload fields do not match the canonical GEO OpenAPI contract', validationErrors };
  const idemParam = operation.parameters.find(param => param.in === 'header' && param.name.toLowerCase() === 'x-idempotency-key');
  if (!idemParam) return { ok: false, outcome: 'rejected', error: 'The generated upload contract is missing X-Idempotency-Key' };
  if (args.idempotencyKey !== undefined) {
    if (typeof args.idempotencyKey !== 'string' || args.idempotencyKey.length < 1 || args.idempotencyKey.length > 200) {
      return { ok: false, outcome: 'rejected', error: 'idempotencyKey must be a non-empty string of at most 200 characters' };
    }
    const keyErrors = validateValue(args.idempotencyKey, idemParam.schema, 'headers.X-Idempotency-Key', catalog.schemas);
    if (keyErrors.length) return { ok: false, outcome: 'rejected', error: 'idempotencyKey does not match the canonical GEO OpenAPI contract', validationErrors: keyErrors };
  }
  if (typeof token !== 'string' || token.trim() === '') return { ok: false, outcome: 'rejected', error: 'GEO project API token is not configured for this project.' };

  let origin;
  try { origin = resolveApiOrigin(baseUrl); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }

  let opened;
  try { opened = await openStagedEvidence(evidenceDirectory, args.fileName); }
  catch (error) { return { ok: false, outcome: 'rejected', error: error.message }; }

  let contentDigest;
  try { contentDigest = await hashStagedFile(opened.handle); }
  catch {
    await opened.handle.close().catch(() => {});
    return { ok: false, outcome: 'rejected', error: 'The staged evidence file could not be read; no GEO request was sent.' };
  }
  const idempotencyKey = args.idempotencyKey || deterministicUploadKey(projectId, contentDigest);
  const keyErrors = validateValue(idempotencyKey, idemParam.schema, 'headers.X-Idempotency-Key', catalog.schemas);
  if (keyErrors.length) {
    await opened.handle.close().catch(() => {});
    return { ok: false, outcome: 'rejected', error: 'The generated idempotency key does not match the canonical GEO OpenAPI contract', validationErrors: keyErrors };
  }

  const boundary = `----geo-${randomUUID().replaceAll('-', '')}`;
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'Accept-Language': 'zh_CN',
    [idemParam.name]: idempotencyKey,
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
  });
  const url = new URL(`${catalog.serverPath.replace(/\/$/, '')}${operation.path}`, `${origin}/`);
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
      error: 'GEO did not return a response. The upload may already have been accepted; inspect this project’s evidence list before attempting any repeat, and reuse the same idempotency key if recovery allows it.',
    };
  }
  await opened.handle.close().catch(() => {});

  const contentType = response.headers.get('content-type') || 'unknown';
  if (response.status >= 300 && response.status < 400) {
    return { ok: false, outcome: 'rejected', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: 'GEO returned a redirect. It was not followed to avoid forwarding credentials to another origin.' };
  }
  if (response.status >= 500) {
    return { ok: false, outcome: 'unknown', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: 'GEO returned a server error after the upload request. Inspect the project evidence list before any recovery; do not submit a new upload.' };
  }

  let text;
  try { text = await readJsonLimited(response); }
  catch (error) {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: error.message };
  }
  if (!contentType.toLowerCase().includes('json')) {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: 'GEO did not return the expected JSON evidence record. Inspect the project evidence list before any recovery.' };
  }
  let envelope;
  try { envelope = JSON.parse(text); }
  catch {
    return { ok: false, outcome: response.ok ? 'unknown' : 'rejected', operation: operation.name, status: response.status, fileName: args.fileName, projectId, idempotencyKey, error: 'GEO returned invalid JSON; inspect the project evidence list before repeating the upload.' };
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
      note: 'GEO response was reduced; use the evidence list to inspect the created record.',
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
    approval: operation.method === 'GET' ? 'none; read only' : 'required; DSH asks the operator before dispatch',
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
    response: operation.hasJsonResponse ? 'GEO JSON envelope' : 'non-JSON response is summarized; body omitted',
    schemas,
  };
}
