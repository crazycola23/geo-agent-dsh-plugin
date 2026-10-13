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
    assert.match(result.error, /请先查这个项目的资料列表/);
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

test('a file dragged into the conversation uploads straight from its attachment path', async () => {
  // 附件保存路径的真实形状：内容寻址、**没有扩展名**。GEO 侧看到的文件名由
  // fileName（原名）决定——运营在对话里看到的就是这个名字，不该被 sha256 顶替。
  await withStagingDirectory(async directory => {
    const attachmentPath = join(directory, '00faf19f1225b7ba0974e1d9632b9bb6705dcd3161a0bc3dec4dec73cf834079');
    await writeFile(attachmentPath, 'attachment evidence body');
    const requests = [];
    const result = await executeGeoEvidenceUpload({
      catalog,
      args: { projectId: '42', filePath: attachmentPath, fileName: '品牌资料.docx' },
      // 暂存目录刻意留空：这条路径完全不该用到它。
      evidenceDirectory: join(directory, 'not-configured-at-all'),
      baseUrl: 'https://geo.example',
      token: 'secret',
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init, body: await new Response(init.body).text() });
        return new Response(JSON.stringify({ code: 200, msg: 'ok', data: { id: 'src-9' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.equal(result.outcome, 'complete');
    assert.equal(result.fileName, '品牌资料.docx');
    assert.match(requests[0].body, /name="file"; filename="品牌资料\.docx"/);
    assert.match(requests[0].body, /attachment evidence body/);
  });
});

test('an attachment path that already carries a supported extension needs no file name', async () => {
  await withStagingDirectory(async directory => {
    const filePath = join(directory, 'brief.pdf');
    await writeFile(filePath, 'pdf bytes');
    let body = '';
    const result = await executeGeoEvidenceUpload({
      catalog,
      args: { projectId: '42', filePath },
      evidenceDirectory: '',
      baseUrl: 'https://geo.example',
      token: 'secret',
      fetchImpl: async (_url, init) => {
        body = await new Response(init.body).text();
        return new Response(JSON.stringify({ code: 200, msg: 'ok', data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    assert.equal(result.outcome, 'complete');
    assert.equal(result.fileName, 'brief.pdf');
    assert.match(body, /filename="brief\.pdf"/);
  });
});

test('attachment-shaped uploads are refused before any request when the file itself is not usable', async () => {
  await withStagingDirectory(async directory => {
    const extensionless = join(directory, 'deadbeef');
    await writeFile(extensionless, 'bytes without an extension');
    const empty = join(directory, 'empty.pdf');
    await writeFile(empty, '');
    const nested = join(directory, 'folder.pdf');
    await mkdir(nested);

    let calls = 0;
    const common = {
      catalog,
      evidenceDirectory: '',
      baseUrl: 'https://geo.example',
      token: 'secret',
      fetchImpl: async () => { calls += 1; throw new Error('network should not be called'); },
    };

    // 无扩展名路径 + 没给原名：没法判断类型，直接拒绝并说清怎么补。
    const noName = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42', filePath: extensionless } });
    assert.equal(noName.outcome, 'rejected');
    assert.match(noName.error, /要同时给出原名/);

    // 原名扩展名不支持。
    const badName = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42', filePath: extensionless, fileName: 'payload.exe' } });
    assert.equal(badName.outcome, 'rejected');

    // 空文件上传没有意义。
    const emptyFile = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42', filePath: empty } });
    assert.equal(emptyFile.outcome, 'rejected');
    assert.match(emptyFile.error, /是空的/);

    // 目录不是文件。
    const directoryUpload = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42', filePath: nested } });
    assert.equal(directoryUpload.outcome, 'rejected');
    assert.match(directoryUpload.error, /不是普通文件/);

    // 不存在的路径。
    const missing = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42', filePath: join(directory, 'nope.pdf') } });
    assert.equal(missing.outcome, 'rejected');

    // 两个都给不出来时说清有两个办法，而不是一句「参数错误」。
    const neither = await executeGeoEvidenceUpload({ ...common, args: { projectId: '42' } });
    assert.equal(neither.outcome, 'rejected');
    assert.match(neither.error, /filePath/);
    assert.match(neither.error, /fileName/);

    assert.equal(calls, 0);
  });
});

test('a symlinked attachment path is refused instead of following the link', async () => {
  await withStagingDirectory(async directory => {
    const target = join(directory, 'real.pdf');
    await writeFile(target, 'real bytes');
    const link = join(directory, 'link.pdf');
    try {
      const { symlink } = await import('node:fs/promises');
      await symlink(target, link);
    } catch {
      // Windows 上创建符号链接需要开发者模式或管理员权限；拿不到就跳过这一格，
      // 而不是把环境限制当成代码缺陷。
      return;
    }
    let calls = 0;
    const result = await executeGeoEvidenceUpload({
      catalog,
      args: { projectId: '42', filePath: link },
      evidenceDirectory: '',
      baseUrl: 'https://geo.example',
      token: 'secret',
      fetchImpl: async () => { calls += 1; throw new Error('network should not be called'); },
    });
    assert.equal(result.outcome, 'rejected');
    assert.match(result.error, /快捷方式或符号链接/);
    assert.equal(calls, 0);
  });
});
