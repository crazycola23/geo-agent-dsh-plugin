import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { GeoWorkbenchPage } from './GeoWorkbenchPage.tsx'
import type { GeoWorkbenchPageProps, GeoSessionProgressViewProps, SessionsService } from './GeoWorkbenchPage.tsx'
import { GeoSessionProgressView } from './GeoWorkbenchPage.tsx'
import { GeoSettingsCard } from './GeoSettingsCard.tsx'
import type { RuntimeProbe } from './GeoSettingsCard.tsx'
import { en, zh } from './locales.ts'
import { PLUGIN_ENTRY_ID, PLUGIN_PACKAGE } from '../runtime-compat.js'

const LOCALE_NAMESPACE = 'settings.geo-workbench'
const BUNDLE_PACKAGE = PLUGIN_PACKAGE
const PROFILE_ENTRY_ID = PLUGIN_ENTRY_ID
// 主视图页与侧边栏入口共用同一个 key，宿主靠它把两者关联起来。
const PAGE_KEY = 'geo-workbench'

/** 侧边栏入口图标，契约同官方插件：接收 { size }。 */
function GeoIcon({ size = 16 }: { size?: number }): ReactNode {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="8" cy="8" rx="2.9" ry="6.2" stroke="currentColor" strokeWidth="1.1" />
      <path d="M1.8 8h12.4" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

type Snapshot = { value?: Record<string, unknown>; writable?: boolean }
type FormScope = {
  getSnapshot(): Snapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}
type CredentialInfo = { configured?: boolean; writable?: boolean; source?: string }
type RemoteResult<T = unknown> = { ok: true; value: T } | { ok: false; error?: { message?: string } }
type RemoteCredentials = {
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
  set(ref: string, value: string): Promise<RemoteResult>
  unset(ref: string): Promise<RemoteResult>
}
type PluginInventorySnapshot = { managementAvailable?: boolean; entries?: unknown[] }
type RemotePluginInventory = {
  list(): Promise<RemoteResult<PluginInventorySnapshot>>
}
type ClientContext = Context & {
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): unknown
    bind(namespace: string): (key: string) => string
  }
  remote?: { credentials?: RemoteCredentials; pluginInventory?: RemotePluginInventory }
  inject(services: string[], callback: (scoped: ClientContext & { configForms?: { get(id: string): FormScope | undefined } }) => void): void
}

/**
 * 配置表单不可用时的占位 scope。
 *
 * 条目没激活（版本不匹配是最常见原因）时 DSH 给不出配置表单，但卡片本身必须
 * 还能渲染 —— 那正是唯一能告诉运营「为什么没工具」的地方。这里给一个只读 scope，
 * 让卡片照常挂载：所有控件因为 writable=false 而禁用，写入路径抛一句人话。
 */
const READ_ONLY_SNAPSHOT: Snapshot = { value: {}, writable: false }
function createReadOnlyScope(): FormScope {
  return {
    getSnapshot: () => READ_ONLY_SNAPSHOT,
    subscribe: () => () => {},
    set: async () => {
      throw new Error('配置表单不可用：这个插件没有在当前 DSH 上激活。')
    },
  }
}

function usableFormScope(candidate: FormScope | undefined): FormScope | undefined {
  if (!candidate) return undefined
  if (typeof candidate.getSnapshot !== 'function'
    || typeof candidate.subscribe !== 'function'
    || typeof candidate.set !== 'function') {
    console.warn(`[geo-agent-dsh-plugin] 配置表单 scope 形状不符合预期；实际键：${Object.keys(candidate).join(',') || '(无)'}`)
    return undefined
  }
  return candidate
}

export const name = 'geo-agent-dsh-plugin-client'
// `remote.credentials` 必须显式声明：cordis 的 remote 是校验型代理，
// 取一个未注入的子命名空间会**直接抛错**（不是返回 undefined），
// 而那个抛错发生在注册卡片之前 —— 会让整张卡永远注册不上。
export const inject = ['slots', 'locale', 'remote', 'remote.credentials']

export function apply(rawContext: Context): void {
  const ctx = rawContext as ClientContext
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'geo-workbench: settings copy')
  const t = ctx.locale.bind(LOCALE_NAMESPACE)

  // configForms is only mounted for namespaces the Host currently serves.
  // Keeping it nested lets the rest of the client bundle load on older hosts.
  //
  // 这一段绝不能静默：曾经因为一行「次要依赖」（remote.credentials 未在 inject 里声明）
  // 抛出 `cannot get property "remote.credentials" without inject`，把整张卡片一起带走，
  // 而 Console 里连红字都没有。任何失败都必须留下日志。
  // 会话服务是软依赖：宿主没提供时工作台页只少流程条，设置卡照常注册。
  const sessionsRef: { current: SessionsService | undefined } = { current: undefined }
  ctx.inject(['sessions'], (scope) => {
    sessionsRef.current = (scope as { sessions?: SessionsService }).sessions
  })

  /**
   * 宿主插件清单 remote：**必须**通过嵌套 inject 取，不能直接读 ctx.remote。
   *
   * cordis 的 remote 是校验型代理，取一个没注入过的子命名空间会直接抛错（官方
   * dsh-client-ui-plugin-manager 也是把 "remote.pluginInventory" 写进 inject 的）。
   * 但写进顶层 inject 就等于「宿主没有它时整条客户端半体不加载」——那正是我们要
   * 修的那种故障。用嵌套 inject 拿到的是软依赖：拿不到就保持 undefined，卡片照常
   * 注册，运行环境一栏如实写「检测不到」。
   */
  const inventoryRef: { current: RemotePluginInventory | undefined } = { current: undefined }
  ctx.inject(['remote.pluginInventory'], (scope) => {
    try {
      const inventory = (scope as ClientContext).remote?.pluginInventory
      if (inventory && typeof inventory.list === 'function') inventoryRef.current = inventory
    } catch {
      // 保持 undefined：探测不到由卡片如实呈现，不在这里抛。
    }
  })

  // 会话视图标签：与「轨迹」同一插槽（conversation.view），按会话展示 GEO 流程进度。
  ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'geo-progress',
    order: 15,
    locale: LOCALE_NAMESPACE,
    label: () => t('progress'),
    inject: (sessionId: string) => ({ sessionId, sessions: sessionsRef.current }),
  }, GeoSessionProgressView)), 'geo-workbench: conversation progress tab')

  ctx.inject(['configForms'], (scoped) => {
    try {
      const formScope = usableFormScope(scoped.configForms?.get(PROFILE_ENTRY_ID))
      if (!formScope) {
        // 这里刻意不 return：条目没激活时（版本不匹配是最常见的原因）宿主给不出
        // 配置表单，而这张卡正是唯一能把原因说给运营听的地方。以只读方式照常注册，
        // 卡片上的「运行环境」一栏会给出判定与理由。
        console.warn(`[geo-agent-dsh-plugin] 宿主未提供「${PROFILE_ENTRY_ID}」的配置表单；卡片以只读方式注册，并在卡片上说明原因。`)
      }

      const scope = formScope
        ? {
            ...formScope,
            getSnapshot: formScope.getSnapshot.bind(formScope),
            subscribe: formScope.subscribe.bind(formScope),
            set: formScope.set.bind(formScope),
          }
        : createReadOnlyScope()

      // 两个 hook 各自顺序固定，注册时二选一、之后不再变，不违反 hooks 规则。
      const liveSnapshot = (): Snapshot => scope.getSnapshot()
      const subscribeScope = (listener: () => void): (() => void) => scope.subscribe(listener)
      const useLiveSnapshot = (): Snapshot => useSyncExternalStore(subscribeScope, liveSnapshot, liveSnapshot)
      const useReadOnlySnapshot = (): Snapshot => READ_ONLY_SNAPSHOT
      const useSnapshot = formScope ? useLiveSnapshot : useReadOnlySnapshot

      // 兜底：即便某个宿主没提供 credentials 远端，也只能让「凭据相关功能」退化，
      // 绝不能让卡片本身注册不上（这正是这张卡长期不出现的直接原因）。
      const credentialRemote = (() => {
        try {
          return scoped.remote?.credentials
        } catch {
          return undefined
        }
      })()

      /**
       * 运行环境探测：读宿主自己的插件清单（软依赖）。
       *
       * 拿不到清单时返回空对象，卡片按 unknown 处理 —— 「探测不到」不等于「一切
       * 正常」，这两件事在版本问题上必须分开。
       *
       * 刻意不看 managementAvailable：它只表示这个 profile 能不能装/卸插件，而我们
       * 只读激活状态。要求它为 true 会把「能读但不可管理」的宿主（桌面应用自己管的
       * profile 就是这样）误判成探测不到。
       */
      const runtimeProbe: RuntimeProbe = async () => {
        try {
          const inventory = inventoryRef.current
          if (!inventory || typeof inventory.list !== 'function') return {}
          const result = await inventory.list()
          const value = result?.ok === true ? result.value : undefined
          if (!value || !Array.isArray(value.entries)) return {}
          return { entries: value.entries }
        } catch {
          return {}
        }
      }

      const injected = (): GeoWorkbenchPageProps => ({
        scope,
        useSnapshot,
        t,
        credentials: credentialRemote,
        sessions: sessionsRef.current,
        runtimeProbe,
        hasConfigForm: formScope !== undefined,
      })

      scoped.effect(() => scoped.slots.inject('plugins.bundle.config', () => scoped.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE_PACKAGE,
        locale: LOCALE_NAMESPACE,
        inject: injected,
      }, (ownerProps = {}) => ownerProps.view === 'summary' ? null : <GeoSettingsCard {...injected()} />)), 'geo-workbench: plugin configuration card')

      // 主界面一级入口：左侧导航面板 + 主视图页，契约与官方 schedule 插件一致
      // （slots.register({ key/id 同值 }) 把两者关联）。设置页里那张卡保持不动，
      // 这条入口让「GEO 工作台」一次点击可达，不再藏在 设置 → 插件 → 条目 三层之下。
      scoped.effect(() => scoped.slots.inject('main', () => scoped.slots.register({
        name: 'main',
        key: PAGE_KEY,
        locale: LOCALE_NAMESPACE,
        inject: injected,
      }, GeoWorkbenchPage)), 'geo-workbench: main page')
      scoped.effect(() => scoped.slots.inject('sidebar.panellist', () => scoped.slots.register({
        name: 'sidebar.panellist',
        id: PAGE_KEY,
        order: 20,
        locale: LOCALE_NAMESPACE,
        label: () => t('title'),
      }, GeoIcon)), 'geo-workbench: sidebar entry')
    } catch (error) {
      console.warn('[geo-agent-dsh-plugin] GEO 工作台卡片注册失败：', error)
    }
  })
}
