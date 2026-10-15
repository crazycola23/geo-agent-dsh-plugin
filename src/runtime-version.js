import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * 读宿主 DSH 的运行时版本（服务端半体专用）。
 *
 * DSH 自己就是这么取的：dsh-app-boot 的 getDshRuntimeVersion() 读的是它自己
 * package.json 的 version，而 peerDependencies 的校验也拿这个值去比。所以这里
 * 读同一个包，得到的就是 DSH 用来判定的那个版本，而不是我们另算一套。
 *
 * dsh-tools 是兜底：同一次发布里 @deepseek-ai/dsh* 的版本号一致，而它本来就是
 * 本插件的 peerDependency，解析得到的概率更高。
 *
 * 解析不到时返回空串。版本未知是「不知道」，不是「通过」——调用方必须如实呈现，
 * 不许拿空串去比较范围。
 */
const RUNTIME_MANIFEST_CANDIDATES = [
  '@deepseek-ai/dsh-app-boot/package.json',
  '@deepseek-ai/dsh-tools/package.json',
];

function defaultResolve(specifier) {
  return createRequire(import.meta.url).resolve(specifier);
}

/**
 * @param resolveModule 注入用：返回 package.json 的绝对路径，解析失败时抛错。
 * @param readFile 注入用：读文件内容。
 */
export function detectRuntimeVersion(resolveModule = defaultResolve, readFile = readFileSync) {
  for (const specifier of RUNTIME_MANIFEST_CANDIDATES) {
    try {
      const manifestPath = resolveModule(specifier);
      const manifest = JSON.parse(readFile(manifestPath, 'utf8'));
      const version = manifest?.version;
      if (typeof version === 'string' && version.trim() !== '') return version.trim();
    } catch {
      // 换下一个候选；全都失败就返回空串。
    }
  }
  return '';
}
