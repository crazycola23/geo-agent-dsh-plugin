import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 打包白名单回归（2026-10-15）。
 *
 * 起因：别人按《安装与配置》从 GitHub 装插件，装完插件列表里能看到，卡片也能打开，
 * 但服务端半体直接 `failed to import`。根因是 package.json 的 `files` 白名单按
 * 单个文件列举 src/，`src/index.js` import 的 `src/stages.js` 不在名单里 ——
 * `npm install <git-url>` 走的是 npm pack 的过滤规则，装到别人机器上的包里根本没有
 * 这个文件。作者本机看不出来，因为桌面 profile 用的是 `link:`，指向整个目录，
 * 不经过白名单。
 *
 * 这条守卫把「入口能 import 到的每个相对模块都必须在 files 覆盖范围内」固定下来：
 * 以后新增一个模块而忘了改 files，这里会先红。
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

/** npm 的 files 条目：`*` 通配、目录前缀、精确文件三种。 */
function isPacked(relativePath, patterns = manifest.files) {
  const target = relativePath.split(sep).join('/');
  for (const pattern of patterns) {
    if (pattern.includes('*')) {
      const regex = new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`);
      if (regex.test(target)) return true;
      continue;
    }
    if (target === pattern) return true;
    // 没有扩展名的条目按目录处理（npm 的语义：目录整个打包）。
    const absolute = resolve(root, pattern);
    if (!pattern.includes('.') && existsSync(absolute) && statSync(absolute).isDirectory()
      && target.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

/** 收集一个模块里所有相对 import 的目标文件。 */
function relativeImportsOf(absolutePath) {
  const source = readFileSync(absolutePath, 'utf8');
  const specifiers = new Set();
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
    specifiers.add(match[1]);
  }
  return [...specifiers].map(specifier => resolve(dirname(absolutePath), specifier));
}

/** 从入口出发走完整张相对 import 图。 */
function reachableModules(entries) {
  const seen = new Set();
  const queue = entries.map(entry => resolve(root, entry));
  while (queue.length > 0) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    if (!existsSync(current)) continue;
    for (const next of relativeImportsOf(current)) {
      if (!seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

test('服务端与客户端入口能 import 到的每个模块都在 files 覆盖范围内', () => {
  const entries = ['src/index.js', 'src/config.js', 'src/client/index.tsx'];
  const modules = reachableModules(entries);
  assert.ok(modules.length >= 8, `入口图太小（${modules.length} 个模块），守卫可能失效`);

  const missing = modules
    .map(absolute => relative(root, absolute).split(sep).join('/'))
    .filter(relativePath => !isPacked(relativePath));

  assert.deepEqual(
    missing,
    [],
    `这些模块被 import 但不在 package.json 的 files 里，别人装到的包里会缺文件、插件 import 失败：${missing.join(', ')}`,
  );
});

test('files 覆盖 src 整目录，而不是逐个文件列举', () => {
  assert.ok(
    manifest.files.includes('src'),
    'src 必须整目录打包：逐个列举就是这次线上故障的成因（新增模块忘改 files 就缺文件）',
  );
});

test('守卫本身能识别目录条目与通配条目', () => {
  assert.equal(isPacked('src/anything/new-file.js'), true);
  assert.equal(isPacked('locale/zh.json'), true);
  assert.equal(isPacked('locale/zh.yaml'), false);
  assert.equal(isPacked('docs/secret.md'), false);
});
