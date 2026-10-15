/**
 * 运行环境兼容判定。客户端半体与设置卡共用，不依赖任何 Node 专有 API。
 *
 * 这个判定必须能在「服务端半体根本没起来」的时候给出结论 —— 版本不匹配就是
 * 这个样子：DSH 在 import 之前就把插件拒了，我们自己的代码一行都没跑。所以
 * 判定只看客户端自己拿得到的事实：
 *
 *   1. 配置表单 scope 在不在。它由 DSH 按 profile 条目提供，与我们的模块无关；
 *      拿不到就说明这一条没激活。
 *   2. 宿主插件清单（remote.pluginInventory，软依赖）。它给出 fiberPhase，以及
 *      DSH 自己记下的激活错误原文 —— 版本不匹配的那句话就在里面。
 *
 * 两者都拿不到时结论是 unknown，绝不放大成 active：版本问题最怕的就是静默通过。
 */

export const PLUGIN_PACKAGE = '@geo-internal/geo-agent-dsh-plugin';
export const PLUGIN_ENTRY_ID = 'geo-agent-dsh-plugin';

/**
 * 已实际验证过的 DSH 运行时范围。
 *
 * 跨 0.x 的 minor 时，本插件用到的 ctx.tools / ctx.agents / ctx.credentials /
 * ctx.systemPrompt 都可能变，所以「验证过」只到 0.2.x。超出这一行的实例不再被
 * 静默放行：卡片顶部会给出提示（见 judgeRuntime）。
 */
export const VERIFIED_DSH_RANGE = '^0.2.0-rc.2';
export const VERIFIED_DSH_LINE = '0.2';

/**
 * package.json 里声明的 peer 范围。必须与它逐字一致 —— test/runtime-compat.test.js
 * 会比对，只改一处就红。
 *
 * 这里刻意比 VERIFIED_DSH_RANGE 宽：DSH 的 peer 校验发生在 import 之前，范围一
 * 不满足，**客户端半体也一起不加载** —— 卡片根本不会出现，运营只看到插件被标成
 * 「异常」，拿不到任何可操作的下一步。宽范围 + 插件自己的版本检测（卡片提示 +
 * geo_runtime_status 工具）才是「不兼容时还能把话说清楚」的唯一办法。
 *
 * 代价要记住：范围外也会加载。apply() 里保留了服务缺失时的显式抛错，让未知版本
 * 上的失败停在「这一条没激活」，而不是把宿主一起带走。
 */
export const PEER_DSH_RANGE = '>=0.2.0-rc.2';
export const REQUIRED_DSH_PEERS = Object.freeze([
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-credentials',
]);

export const RUNTIME_VERDICT = Object.freeze({
  ACTIVE: 'active',
  FAILED: 'failed',
  DISABLED: 'disabled',
  MISSING: 'missing',
  UNSUPPORTED: 'unsupported',
  UNKNOWN: 'unknown',
});

/**
 * 运行时版本是否落在验证过的行上。
 *
 * 只比 major.minor，不自己实现 semver 区间比较 —— 手写比较器出错的方式很隐蔽，
 * 而这里要回答的问题本来就是「是不是 0.2 这一行」。预发布版本（0.2.0-rc.2）与
 * 正式版（0.2.0）都算在 0.2 行上，这正是我们要的粒度。
 *
 * 空串 = 读不到版本 → 返回 undefined（unknown），不当作「不支持」。
 */
export function runtimeVersionSupported(version) {
  if (typeof version !== 'string') return undefined;
  const trimmed = version.trim();
  if (trimmed === '') return undefined;
  const match = /^(\d+)\.(\d+)\./.exec(trimmed);
  if (!match) return undefined;
  return `${match[1]}.${match[2]}` === VERIFIED_DSH_LINE;
}

function errorTextOf(entry) {
  const message = entry?.meta?.error;
  return typeof message === 'string' ? message.trim() : '';
}

/**
 * 在插件清单里找本条目。
 *
 * 按 entryId 找是主路径；moduleName 兜底是因为 entryId 由 profile 的 id 决定，
 * 别人手写 cordis.patch.yml 时可能取成别的名字。
 */
export function findRuntimeEntry(entries, entryId = PLUGIN_ENTRY_ID) {
  if (!Array.isArray(entries)) return undefined;
  return entries.find((entry) => entry
    && (entry.entryId === entryId || entry.moduleName === PLUGIN_PACKAGE));
}

/**
 * 判定当前运行环境。
 *
 * @param entries 插件清单（remote.pluginInventory.list() 的 entries）；拿不到时传 undefined
 * @param hasConfigForm 宿主是否提供了本条目的配置表单 scope
 * @param runtimeVersion 宿主 DSH 版本（服务端半体探测，经配置快照送到卡片）；读不到时传空串
 * @returns {{verdict: string, detail: string, entry?: object}}
 */
export function judgeRuntime({ entries, hasConfigForm, runtimeVersion } = {}) {
  // 版本能读到时，它是最硬的事实：先回答「这一行我验证过没有」。
  const supported = runtimeVersionSupported(runtimeVersion);
  if (supported === false) {
    return { verdict: RUNTIME_VERDICT.UNSUPPORTED, detail: String(runtimeVersion).trim() };
  }

  if (!Array.isArray(entries)) {
    // 清单探测不可用（老宿主 / 没有这个 remote）：只能退回配置表单这一个事实。
    // 表单在 = 条目注册过，但那不等于「版本合适」，所以是 unknown 而不是 active；
    // 表单不在 = 这一条确实没激活，那才是能下结论的 failed。
    return hasConfigForm
      ? { verdict: RUNTIME_VERDICT.UNKNOWN, detail: '' }
      : { verdict: RUNTIME_VERDICT.FAILED, detail: '' };
  }

  const entry = findRuntimeEntry(entries);
  if (!entry) return { verdict: RUNTIME_VERDICT.MISSING, detail: '' };
  if (entry.enabled === false) return { verdict: RUNTIME_VERDICT.DISABLED, detail: '', entry };
  if (entry.fiberPhase === 'failed') {
    return { verdict: RUNTIME_VERDICT.FAILED, detail: errorTextOf(entry), entry };
  }
  if (entry.fiberPhase === 'active') return { verdict: RUNTIME_VERDICT.ACTIVE, detail: '', entry };

  // pending / loading / unloading / null：还没收敛出结果，不当作正常。
  return { verdict: RUNTIME_VERDICT.UNKNOWN, detail: errorTextOf(entry), entry };
}

/**
 * 判定结果 → 卡片上要显示的话。
 *
 * tone 决定颜色：ok 绿、warn 黄、error 红、muted 灰。detail 里带上插件要求的范围，
 * 因为运营看到提示的第一件事就是「那我该装哪个版本」。
 */
export function runtimeNotice(result) {
  const required = `本插件只在 DSH ${VERIFIED_DSH_RANGE} 上验证过`;
  switch (result?.verdict) {
    case RUNTIME_VERDICT.ACTIVE:
      return { tone: 'ok', title: '运行环境正常', detail: required };
    case RUNTIME_VERDICT.UNSUPPORTED:
      return {
        tone: 'error',
        title: `当前 DSH ${result.detail || ''} 不在验证范围内`,
        detail: `${required}；这一行之外的接口可能有变，工具能不能用没有保证。请换用 DSH ${VERIFIED_DSH_LINE}.x，或确认这一行上功能正常后再继续。`,
      };
    case RUNTIME_VERDICT.DISABLED:
      return {
        tone: 'warn',
        title: '插件条目被禁用了',
        detail: 'GEO 工具不会注册。在 DSH 的插件列表里把它重新启用，然后完全退出 DSH 再启动。',
      };
    case RUNTIME_VERDICT.MISSING:
      return {
        tone: 'error',
        title: '当前 DSH 没有注册这个插件',
        detail: `${required}。请确认装在了当前 profile，且装完完全退出 DSH 再启动。`,
      };
    case RUNTIME_VERDICT.FAILED:
      return {
        tone: 'error',
        title: '插件在当前 DSH 上没能激活',
        detail: `${required}；GEO 工具因此不会出现。先换回验证过的 DSH 版本再排查。`,
      };
    default:
      return {
        tone: 'muted',
        title: '无法自动检测运行环境',
        detail: `${required}。若工具没出现，先确认 DSH 版本在这个范围内。`,
      };
  }
}
