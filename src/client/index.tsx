import { useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { GeoSettingsCard } from './GeoSettingsCard.tsx'
import type { GeoSettingsCardProps } from './GeoSettingsCard.tsx'
import { en, zh } from './locales.ts'

const LOCALE_NAMESPACE = 'settings.geo-workbench'
const BUNDLE_PACKAGE = '@geo-internal/geo-agent-dsh-plugin'
const PROFILE_ENTRY_ID = 'geo-agent-dsh-plugin'

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
    register(options: Record<string, unknown>, render: (ownerProps?: { view?: string }) => unknown): unknown
  }
  locale: {
    register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): unknown
    bind(namespace: string): (key: string) => string
  }
  remote?: { credentials?: RemoteCredentials }
  inject(services: string[], callback: (scoped: ClientContext & { configForms?: { get(id: string): FormScope | undefined } }) => void): void
}

export const name = 'geo-agent-dsh-plugin-client'
export const inject = ['slots', 'locale', 'remote']

export function apply(rawContext: Context): void {
  const ctx = rawContext as ClientContext
  ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, { zh, en }), 'geo-workbench: settings copy')
  const t = ctx.locale.bind(LOCALE_NAMESPACE)

  // configForms is only mounted for namespaces the Host currently serves.
  // Keeping it nested lets the rest of the client bundle load on older hosts.
  ctx.inject(['configForms'], (scoped) => {
    const formScope = scoped.configForms?.get(PROFILE_ENTRY_ID)
    if (!formScope) return

    const getSnapshot = formScope.getSnapshot.bind(formScope)
    const subscribe = formScope.subscribe.bind(formScope)
    const scope = { ...formScope, getSnapshot, subscribe, set: formScope.set.bind(formScope) }
    const useSnapshot = () => useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    const credentialRemote = scoped.remote?.credentials
    const injected = (): GeoSettingsCardProps => ({ scope, useSnapshot, t, credentials: credentialRemote })

    scoped.effect(() => scoped.slots.inject('plugins.bundle.config', () => scoped.slots.register({
      name: 'plugins.bundle.config',
      key: BUNDLE_PACKAGE,
      locale: LOCALE_NAMESPACE,
      inject: injected,
    }, (ownerProps = {}) => ownerProps.view === 'summary' ? null : <GeoSettingsCard {...injected()} />)), 'geo-workbench: plugin configuration card')
  })
}
