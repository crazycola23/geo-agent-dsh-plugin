import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import catalog from '../src/generated/openapi.catalog.json' with { type: 'json' };
import { executeGeoEvidenceUpload, executeGeoOperation, listStagedEvidenceFiles } from '../src/api-client.js';

async function withStagingDirectory(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'geo-evidence-stage-'));
  try { await callback(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test('evidence upload uses the fixed multipart GEO route and a stable content-derived UUID', async () => {
  await withStagingDirectory(async evidenceDirectory => {
    await writeFile(join(evidenceDirectory, 'brief.pdf'), 'staged evidence body');
    const requests = [];
    const fetchImpl = async (url, init) => {
      const body = await new Response(init.body).text();
      requests.push({ url: String(url), init, body });
      return new Response(JSON.stringify({ code: 200, msg: 'ok', data: { id: 'src-1', name: 'Brief' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const input = {
      catalog,
      args: { projectId: '42', fileName: 'brief.pdf', name: 'Brief' },
      evidenceDirectory,
      baseUrl: 'https://geo.example',
      token: 'secret-token-value',
      fetchImpl,
    };
    const first = await executeGeoEvidenceUpload(input);
    const second = await executeGeoEvidenceUpload(input);

    assert.equal(first.outcome, 'complete');
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.match(first.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(requests[0].url, 'https://geo.example/geo/evidence-sources/upload');
    assert.equal(requests[0].init.method, 'POST');
    assert.equal(requests[0].init.redirect, 'manual');
    assert.equal(requests[0].init.duplex, 'half');
    assert.match(requests[0].init.headers.get('content-type'), /^multipart\/form-data; boundary=/);
    assert.equal(requests[0].init.headers.get('authorization'), 'Bearer secret-token-value');
    assert.equal(requests[0].init.headers.get('x-idempotency-key'), first.idempotencyKey);
    assert.match(requests[0].body, /name="projectId"\r\n\r\n42/);
    assert.match(requests[0].body, /name="name"\r\n\r\nBrief/);
    assert.match(requests[0].body, /name="file"; filename="brief\.pdf"/);
    assert.match(requests[0].body, /staged evidence body/);
    assert.equal(JSON.stringify(first).includes('secret-token-value'), false);
  });
});

test('upload rejects paths, unsupported extensions, and unknown JSON routing before network dispatch', async () => {
  await withStagingDirectory(async evidenceDirectory => {
    await writeFile(join(evidenceDirectory, 'brief.pdf'), 'evidence');
    let calls = 0;
    const fetchImpl = async () => { calls += 1; throw new Error('network should not be called'); };
    const common = { catalog, evidenceDirectory, baseUrl: 'https://geo.example', token: 'secret', fetchImpl };

    const traversal = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42', fileName: '..\\outside.pdf' } });
    assert.equal(traversal.outcome, 'rejected');
    const absolute = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42', fileName: join(evidenceDirectory, 'brief.pdf') } });
    assert.equal(absolute.outcome, 'rejected');
    const extension = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42', fileName: 'brief.exe' } });
    assert.equal(extension.outcome, 'rejected');
    const generic = await executeGeoOperation({ ...common, operationName: 'post_evidence_sources_upload', args: { body: { projectId: '42' } } });
    assert.equal(generic.outcome, 'rejected');
    assert.match(generic.error, /geo_upload_evidence/);
    assert.equal(calls, 0);
  });
});

test('upload network uncertainty returns the same key and never retries', async () => {
  await withStagingDirectory(async evidenceDirectory => {
    await writeFile(join(evidenceDirectory, 'brief.txt'), 'evidence');
    let calls = 0;
    const result = await executeGeoEvidenceUpload({
      catalog,
      args: { projectId: '42', fileName: 'brief.txt' },
      evidenceDirectory,
      baseUrl: 'https://geo.example',
      token: 'secret',
      fetchImpl: async (_url, init) => {
        calls += 1;
        await new Response(init.body).arrayBuffer();
        throw new Error('socket reset after upload');
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.outcome, 'unknown');
    assert.match(result.idempotencyKey, /^[0-9a-f-]{36}$/i);
    assert.match(result.error, /inspect this project’s evidence list/);
  });
});

test('staging file listing exposes only supported regular direct-child file names and sizes', async () => {
  await withStagingDirectory(async evidenceDirectory => {
    await writeFile(join(evidenceDirectory, 'brief.pdf'), 'pdf');
    await writeFile(join(evidenceDirectory, 'notes.txt'), 'text');
    await writeFile(join(evidenceDirectory, 'image.png'), 'ignore');
    await mkdir(join(evidenceDirectory, 'nested.pdf'));
    const result = await listStagedEvidenceFiles(evidenceDirectory);
    assert.equal(result.ok, true);
    assert.deepEqual(result.files.map(file => file.fileName), ['brief.pdf', 'notes.txt']);
    assert.deepEqual(result.files.map(file => file.bytes), [3, 4]);
  });
});
