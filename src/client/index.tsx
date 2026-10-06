import { useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { GeoWorkbenchPage } from './GeoWorkbenchPage.tsx'
import type { GeoWorkbenchPageProps, GeoSessionProgressViewProps, SessionsService } from './GeoWorkbenchPage.tsx'
import { GeoSessionProgressView } from './GeoWorkbenchPage.tsx'
import { GeoSettingsCard } from './GeoSettingsCard.tsx'
import { en, zh } from './locales.ts'

const LOCALE_NAMESPACE = 'settings.geo-workbench'
const BUNDLE_PACKAGE = '@geo-internal/geo-agent-dsh-plugin'
const PROFILE_ENTRY_ID = 'geo-agent-dsh-plugin'
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
type ClientContext = Context & {
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): unknown
  }
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): unknown
    bind(namespace: string): (key: string) => string
  }
  remote?: { credentials?: RemoteCredentials }
  inject(services: string[], callback: (scoped: ClientContext & { configForms?: { get(id: string): FormScope | undefined } }) => void): void
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
      const formScope = scoped.configForms?.get(PROFILE_ENTRY_ID)
      if (!formScope) {
        console.warn(`[geo-agent-dsh-plugin] 宿主未提供「${PROFILE_ENTRY_ID}」的配置表单，GEO 工作台卡片不会出现。`)
        return
      }
      if (typeof formScope.getSnapshot !== 'function'
        || typeof formScope.subscribe !== 'function'
        || typeof formScope.set !== 'function') {
        console.warn(`[geo-agent-dsh-plugin] 配置表单 scope 形状不符合预期；实际键：${Object.keys(formScope).join(',') || '(无)'}`)
        return
      }

      const getSnapshot = formScope.getSnapshot.bind(formScope)
      const subscribe = formScope.subscribe.bind(formScope)
      const scope = { ...formScope, getSnapshot, subscribe, set: formScope.set.bind(formScope) }
      const useSnapshot = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      // 兜底：即便某个宿主没提供 credentials 远端，也只能让「凭据相关功能」退化，
      // 绝不能让卡片本身注册不上（这正是这张卡长期不出现的直接原因）。
      const credentialRemote = (() => {
        try {
          return scoped.remote?.credentials
        } catch {
          return undefined
        }
      })()
      const injected = (): GeoWorkbenchPageProps => ({ scope, useSnapshot, t, credentials: credentialRemote, sessions: sessionsRef.current })

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
