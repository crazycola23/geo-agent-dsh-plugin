import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import catalog from '../src/generated/openapi.catalog.json' with { type: 'json' };
import { articleExportFileName, executeGeoArticleExport } from '../src/api-client.js';

const newestId = '2107747985253826562';
const baseUrl = 'https://geo.example.com';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** 列表返回一篇，详情返回带正文的稿件，图库按传入内容返回；其余路径一律 404。 */
function catalogFetch(detail, seen = [], gallery = { rows: [] }) {
  return async url => {
    const { pathname } = new URL(url);
    seen.push(pathname);
    if (pathname.endsWith('/article-versions')) {
      return jsonResponse({ code: 200, data: { rows: [{ id: newestId }], total: 1 } });
    }
    if (pathname.endsWith(`/article-versions/${newestId}`)) {
      return jsonResponse({ code: 200, data: detail });
    }
    if (pathname.endsWith('/oss-images')) {
      return jsonResponse({ code: 200, data: gallery });
    }
    return jsonResponse({ code: 404, msg: 'No endpoint.' }, 404);
  };
}

const detail = {
  id: newestId,
  title: '万事达信用卡跨境支付优势：三重保障让境外消费更从容',
  body: '出境旅行或海淘时，一张能在当地顺畅使用的信用卡，往往决定了消费体验的顺畅程度。',
  versionNo: 'v1.2',
  status: 'generated',
  statusLabel: '已生成',
  enabled: true,
  contentTaskName: 'OpsRun 万事达跨境支付内容任务',
  questionText: '万事达信用卡在跨境支付时有哪些优势',
  claims: [{ claimText: 'a' }, { claimText: 'b' }],
  factRevisionIds: ['2107488241988665347'],
};

async function workspace() {
  return mkdtemp(join(tmpdir(), 'geo-export-'));
}

test('export file name collapses path characters and keeps the version suffix', () => {
  assert.equal(articleExportFileName('标题/带:非法*字符?', 'v1.2', '1'), '标题 带 非法 字符-v1.2.md');
  assert.equal(articleExportFileName('', 'v1.2', '99'), 'article-99-v1.2.md');
  assert.equal(articleExportFileName('标题', undefined, '99'), '标题-id-99.md');
  const long = articleExportFileName('长'.repeat(400), 'v1.2', '1');
  assert.ok(long.length <= 130, '文件名必须被截断到安全长度');
  assert.ok(long.endsWith('-v1.2.md'));
});

test('export refuses before any request when the export directory is not configured', async () => {
  const seen = [];
  const result = await executeGeoArticleExport({
    catalog,
    args: { projectId: '2097157799925620737', articleVersionId: newestId },
    exportDirectory: '',
    baseUrl,
    token: 'token',
    fetchImpl: catalogFetch(detail, seen),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /导出目录/);
  assert.deepEqual(seen, [], '未配置目录时不应发出任何请求');
});

test('export writes markdown and reports metadata for the newest article', async () => {
  const dir = await workspace();
  const result = await executeGeoArticleExport({
    catalog,
    args: { projectId: '2097157799925620737' },
    exportDirectory: dir,
    baseUrl,
    token: 'token',
    fetchImpl: catalogFetch(detail),
  });
  assert.equal(result.ok, true);
  assert.equal(result.articleVersionId, newestId);
  assert.equal(result.claimCount, 2);
  assert.ok(result.fileName.endsWith('-v1.2.md'));

  const written = await readFile(join(dir, result.fileName), 'utf8');
  assert.ok(written.startsWith('# 万事达信用卡跨境支付优势'), '首行应是一级标题');
  assert.ok(written.includes('| 稿件版本 | 2107747985253826562（v1.2） |'));
  assert.ok(written.includes(detail.body), '正文必须完整落盘');
  assert.ok(written.includes('| 公开声明 | 2 条 |'));
});

test('export refuses traversal, non-markdown names, and symlink targets', async () => {
  const dir = await workspace();
  const outside = await workspace();
  await writeFile(join(outside, 'secret.md'), 'x', 'utf8');
  // Windows 上建符号链接需要额外权限；建不出来就跳过这一条，其余用例照跑。
  const linkable = await symlink(join(outside, 'secret.md'), join(dir, 'linked.md')).then(() => true, () => false);

  const names = ['../escaped.md', 'sub/dir.md', 'plain.txt'];
  if (linkable) names.push('linked.md');
  for (const fileName of names) {
    const result = await executeGeoArticleExport({
      catalog,
      args: { projectId: '2097157799925620737', articleVersionId: newestId, fileName },
      exportDirectory: dir,
      baseUrl,
      token: 'token',
      fetchImpl: catalogFetch(detail),
    });
    assert.equal(result.ok, false, `${fileName} 必须被拒绝`);
    assert.match(result.error, /导出|\.md/);
  }

  const escaped = await lstat(join(outside, 'escaped.md')).catch(() => null);
  assert.equal(escaped, null, '目录穿越不得在导出目录之外落盘');
  const secret = await readFile(join(outside, 'secret.md'), 'utf8');
  assert.equal(secret, 'x', '符号链接指向的文件不得被覆写');
});

test('export reuses the same file name on a second run instead of piling up copies', async () => {
  const dir = await workspace();
  const runExport = () => executeGeoArticleExport({
    catalog,
    args: { projectId: '2097157799925620737', articleVersionId: newestId },
    exportDirectory: dir,
    baseUrl,
    token: 'token',
    fetchImpl: catalogFetch(detail),
  });
  const first = await runExport();
  const second = await runExport();
  assert.equal(first.fileName, second.fileName);
  const written = await readFile(join(dir, second.fileName), 'utf8');
  assert.ok(written.includes(detail.body));
});

test('export refuses when the article has no body', async () => {
  const dir = await workspace();
  const result = await executeGeoArticleExport({
    catalog,
    args: { projectId: '2097157799925620737', articleVersionId: newestId },
    exportDirectory: dir,
    baseUrl,
    token: 'token',
    fetchImpl: catalogFetch({ ...detail, body: '' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /没有正文/);
});

test('export creates the configured directory when it does not exist yet', async () => {
  const dir = await workspace();
  const missing = join(dir, 'not-created');
  const result = await executeGeoArticleExport({
    catalog,
    args: { projectId: '2097157799925620737', articleVersionId: newestId },
    exportDirectory: missing,
    baseUrl,
    token: 'token',
    fetchImpl: catalogFetch(detail),
  });
  assert.equal(result.ok, true, '导出目录首次使用时应当被建出来，而不是让运营员先去建');
  const written = await readFile(join(missing, result.fileName), 'utf8');
  assert.ok(written.includes(detail.body));
});

test('gallery images ride along as OSS links when explicitly requested', async () => {
  const dir = await workspace();
  const gallery = {
    rows: [{
      ossId: '2107317879838179329',
      url: 'https://geo-v2.oss-cn-hangzhou.aliyuncs.com/2026/10/06/1151ff8d8352433f87f092174b22a879.png',
      originalName: 'default.png',
      fileName: '2026/10/06/1151ff8d8352433f87f092174b22a879.png',
    }],
  };
  const result = await executeGeoArticleExport({
    catalog,
    args: { projectId: '2097157799925620737', articleVersionId: newestId, includeGalleryImages: true },
    exportDirectory: dir,
    baseUrl,
    token: 'token',
    fetchImpl: catalogFetch(detail, [], gallery),
  });
  assert.equal(result.ok, true);
  assert.equal(result.galleryImageCount, 1);

  const written = await readFile(join(dir, result.fileName), 'utf8');
  assert.ok(written.includes('## 素材图片（项目图库，OSS 直链）'));
  assert.ok(written.includes('![default.png](https://geo-v2.oss-cn-hangzhou.aliyuncs.com/2026/10/06/1151ff8d8352433f87f092174b22a879.png)'));
  // 依赖直链就意味着不落图片副本：导出目录里只能有这一个 .md。
  assert.deepEqual(await readdir(dir), [result.fileName]);
});

test('the gallery section stays out unless it was asked for', async () => {
  const dir = await workspace();
  const result = await executeGeoArticleExport({
    catalog,
    args: { projectId: '2097157799925620737', articleVersionId: newestId },
    exportDirectory: dir,
    baseUrl,
    token: 'token',
    fetchImpl: catalogFetch(detail, [], {
      rows: [{ url: 'https://geo-v2.oss-cn-hangzhou.aliyuncs.com/never-requested.png', originalName: 'x.png' }],
    }),
  });
  assert.equal(result.galleryImageCount, 0);
  const written = await readFile(join(dir, result.fileName), 'utf8');
  assert.ok(!written.includes('素材图片'));
  assert.ok(!written.includes('never-requested.png'));
});