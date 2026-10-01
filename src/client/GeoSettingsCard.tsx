import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { en } from './locales.ts'
import styles from './geo-settings.module.css'

type CredentialInfo = { configured?: boolean; writable?: boolean; source?: string }
type RemoteResult<T = unknown> = { ok: true; value: T } | { ok: false; error?: { message?: string } }
type CredentialRemote = {
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
  set(ref: string, value: string): Promise<RemoteResult>
  unset(ref: string): Promise<RemoteResult>
}
type ProjectSettings = { projectId: string; name?: string }
type ProjectDraft = ProjectSettings & { draftKey: string; clientId: string; clientSecret: string; persisted: boolean }
type SettingsValue = { apiBaseUrl?: string; evidenceDirectory?: string; timeoutMs?: number; projects?: ProjectSettings[] }
type ScopeSnapshot = { value?: SettingsValue; writable?: boolean }
type FormScope = {
  getSnapshot(): ScopeSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<void>
}

export interface GeoSettingsCardProps {
  scope: FormScope
  useSnapshot: () => ScopeSnapshot
  t: (key: keyof typeof en) => string
  credentials?: CredentialRemote
}

function normalizeOrigin(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('请填写 GEO 服务地址。')
  const url = new URL(value.includes('://') ? value : `https://${value}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('请填写服务协议、IP/域名和端口，不要填写路径、用户名或查询参数。')
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('机器认证要求 HTTPS；内网 IP 也需要配置 HTTPS。')
  }
  return url.origin
}

function validProjectId(value: string): boolean {
  return /^[1-9]\d{0,19}$/.test(value.trim())
}

function credentialRefs(projectId: string): { clientId: string; clientSecret: string } {
  const prefix = `GEO_PROJECT_${projectId}`
  return { clientId: `${prefix}_CLIENT_ID`, clientSecret: `${prefix}_CLIENT_SECRET` }
}

function validateMachineSecret(value: string): boolean {
  return /^[!-~]{32,72}$/.test(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '保存失败，请检查 DSH 配置服务。'
}

function draftsFrom(projects: ProjectSettings[] | undefined): ProjectDraft[] {
  return (projects ?? []).map((project, index) => ({
    draftKey: `saved-${project.projectId}-${index}`,
    projectId: project.projectId,
    name: project.name ?? '',
    clientId: '',
    clientSecret: '',
    persisted: true,
  }))
}

function Field(props: {
  label: string
  hint?: string
  value: string
  onChange(value: string): void
  placeholder?: string
  type?: 'text' | 'password' | 'number'
  min?: number
  max?: number
  autoComplete?: string
  disabled?: boolean
  testId: string
}): ReactNode {
  const { label, hint, value, onChange, placeholder, type = 'text', min, max, autoComplete, disabled, testId } = props
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        type={type}
        value={value}
        placeholder={placeholder}
        min={min}
        max={max}
        autoComplete={autoComplete}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  )
}

async function describeCredentials(credentials: CredentialRemote, refs: string[]): Promise<Record<string, CredentialInfo>> {
  if (refs.length === 0) return {}
  const result = await credentials.describe(refs)
  if (!result.ok) throw new Error(result.error?.message || '无法读取 DSH 凭据状态。')
  return result.value
}

async function writeCredential(credentials: CredentialRemote, ref: string, value: string): Promise<void> {
  const result = await credentials.set(ref, value)
  if (!result.ok) throw new Error(result.error?.message || 'DSH 拒绝保存机器凭据。')
}

async function removeCredential(credentials: CredentialRemote, ref: string): Promise<void> {
  const result = await credentials.unset(ref)
  if (!result.ok) throw new Error(result.error?.message || 'DSH 拒绝删除机器凭据。')
}

function CredentialState(props: { label: string; info?: CredentialInfo }): ReactNode {
  const configured = props.info?.configured === true
  const label = configured ? (props.info?.writable === false ? '已配置 · 由外部管理' : '已安全保存') : '未配置'
  return (
    <span className={`${styles.credentialState} ${configured ? styles.credentialStateReady : ''}`}>
      <span className={styles.stateDot} />{props.label}：{label}
    </span>
  )
}

export function GeoSettingsCard(props: GeoSettingsCardProps): ReactNode {
  const { scope, useSnapshot, t, credentials } = props
  const snapshot = useSnapshot()
  const value = snapshot.value ?? {}
  const [expanded, setExpanded] = useState(true)
  const [apiBaseUrl, setApiBaseUrl] = useState(value.apiBaseUrl ?? '')
  const [evidenceDirectory, setEvidenceDirectory] = useState(value.evidenceDirectory ?? '')
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(Math.round((value.timeoutMs ?? 30_000) / 1_000)))
  const [projects, setProjects] = useState(() => draftsFrom(value.projects))
  const [credentialState, setCredentialState] = useState<Record<string, CredentialInfo>>({})
  const [credentialError, setCredentialError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()
  const [removedProjectIds, setRemovedProjectIds] = useState<string[]>([])
  const [confirmRemoveKey, setConfirmRemoveKey] = useState<string | undefined>()
  const nextDraftId = useRef(0)

  useEffect(() => {
    if (dirty) return
    setApiBaseUrl(value.apiBaseUrl ?? '')
    setEvidenceDirectory(value.evidenceDirectory ?? '')
    setTimeoutSeconds(String(Math.round((value.timeoutMs ?? 30_000) / 1_000)))
    setProjects(draftsFrom(value.projects))
  }, [dirty, value.apiBaseUrl, value.evidenceDirectory, value.timeoutMs, value.projects])

  const refsInUse = projects.flatMap(project => validProjectId(project.projectId)
    ? Object.values(credentialRefs(project.projectId.trim()))
    : [])
  const refsKey = [...new Set(refsInUse)].sort().join('|')

  useEffect(() => {
    if (!credentials) {
      setCredentialError('当前 DSH 没有提供凭据设置接口。')
      return
    }
    const refs = refsKey ? refsKey.split('|') : []
    if (refs.length === 0) {
      setCredentialState({})
      setCredentialError(undefined)
      return
    }
    let stale = false
    void describeCredentials(credentials, refs).then((state) => {
      if (!stale) {
        setCredentialState(current => ({ ...current, ...state }))
        setCredentialError(undefined)
      }
    }).catch((error: unknown) => {
      if (!stale) setCredentialError(errorMessage(error))
    })
    return () => { stale = true }
  }, [credentials, refsKey])

  const configuredProjectCount = projects.filter(project => {
    if (!validProjectId(project.projectId)) return false
    const refs = credentialRefs(project.projectId.trim())
    return credentialState[refs.clientId]?.configured === true && credentialState[refs.clientSecret]?.configured === true
  }).length
  const endpointReady = apiBaseUrl.trim().length > 0
  const statusCopy = endpointReady && configuredProjectCount > 0 ? `待验证 · ${configuredProjectCount} 个项目` : '待配置'

  const markDirty = (): void => {
    setDirty(true)
    setSaved(false)
    setFailure(undefined)
  }

  const updateProject = (draftKey: string, field: keyof Pick<ProjectDraft, 'projectId' | 'name' | 'clientId' | 'clientSecret'>, nextValue: string): void => {
    markDirty()
    setProjects(current => current.map(project => project.draftKey === draftKey ? { ...project, [field]: nextValue } : project))
  }

  const addProject = (): void => {
    nextDraftId.current += 1
    markDirty()
    setProjects(current => [...current, {
      draftKey: `new-${nextDraftId.current}`,
      projectId: '',
      name: '',
      clientId: '',
      clientSecret: '',
      persisted: false,
    }])
  }

  const confirmRemoveProject = (project: ProjectDraft): void => {
    const projectId = project.projectId.trim()
    if (project.persisted && validProjectId(projectId)) {
      setRemovedProjectIds(current => current.includes(projectId) ? current : [...current, projectId])
    }
    markDirty()
    setProjects(current => current.filter(item => item.draftKey !== project.draftKey))
    setConfirmRemoveKey(undefined)
  }

  const save = async (): Promise<void> => {
    if (!credentials) {
      setFailure('当前 DSH 没有提供凭据设置接口，无法安全保存项目凭据。')
      return
    }
    let origin: string
    try {
      origin = normalizeOrigin(apiBaseUrl)
    } catch (error) {
      setFailure(errorMessage(error))
      return
    }

    const seconds = Number(timeoutSeconds)
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
      setFailure('请求超时需为 1–120 秒的整数。')
      return
    }

    const normalizedProjects: ProjectSettings[] = []
    const seenProjectIds = new Set<string>()
    const seenClientIds = new Map<string, string>()
    const credentialWrites: Array<{ ref: string; value: string }> = []
    for (const project of projects) {
      const projectId = project.projectId.trim()
      if (!validProjectId(projectId)) {
        setFailure('每个项目都要填写有效的 GEO 项目 ID（正整数）。')
        return
      }
      if (seenProjectIds.has(projectId)) {
        setFailure(`项目 ID ${projectId} 重复了；每个项目只能配置一组机器凭据。`)
        return
      }
      seenProjectIds.add(projectId)
      if (project.name.trim().length > 80) {
        setFailure(`项目 ${projectId} 的名称不能超过 80 个字符。`)
        return
      }

      const refs = credentialRefs(projectId)
      const clientId = project.clientId.trim()
      const clientSecret = project.clientSecret
      const clientIdConfigured = credentialState[refs.clientId]?.configured === true
      const secretConfigured = credentialState[refs.clientSecret]?.configured === true
      if (clientId && clientId.length > 64) {
        setFailure(`项目 ${projectId} 的 Client ID 不能超过 64 个字符。`)
        return
      }
      if (clientId) {
        const otherProjectId = seenClientIds.get(clientId)
        if (otherProjectId) {
          setFailure(`项目 ${projectId} 与项目 ${otherProjectId} 使用了相同 Client ID；每个项目必须配置独立机器客户端。`)
          return
        }
        seenClientIds.set(clientId, projectId)
      }
      if (clientSecret && !validateMachineSecret(clientSecret)) {
        setFailure(`项目 ${projectId} 的 Client Secret 需要 32–72 位可打印 ASCII 字符，不能包含空格。`)
        return
      }
      if (!clientId && !clientIdConfigured) {
        setFailure(`请填写项目 ${projectId} 的 Client ID。`)
        return
      }
      if (!clientSecret && !secretConfigured) {
        setFailure(`请填写项目 ${projectId} 的 Client Secret。`)
        return
      }
      if (clientId && credentialState[refs.clientId]?.writable === false) {
        setFailure(`项目 ${projectId} 的 Client ID 由外部管理，无法在此覆盖。`)
        return
      }
      if (clientSecret && credentialState[refs.clientSecret]?.writable === false) {
        setFailure(`项目 ${projectId} 的 Client Secret 由外部管理，无法在此覆盖。`)
        return
      }
      if (clientId) credentialWrites.push({ ref: refs.clientId, value: clientId })
      if (clientSecret) credentialWrites.push({ ref: refs.clientSecret, value: clientSecret })
      normalizedProjects.push({ projectId, name: project.name.trim() })
    }

    setBusy(true)
    setFailure(undefined)
    let credentialWriteAttempted = false
    let credentialWritesComplete = false
    let projectSettingsSaved = false
    try {
      for (const item of credentialWrites) {
        credentialWriteAttempted = true
        await writeCredential(credentials, item.ref, item.value)
      }
      credentialWritesComplete = true
      await scope.set('apiBaseUrl', origin)
      await scope.set('evidenceDirectory', evidenceDirectory.trim())
      await scope.set('timeoutMs', seconds * 1_000)
      await scope.set('projects', normalizedProjects)
      projectSettingsSaved = true

      const savedIds = new Set(normalizedProjects.map(project => project.projectId))
      const idsToClear = removedProjectIds.filter(projectId => !savedIds.has(projectId))
      for (const projectId of idsToClear) {
        const refs = credentialRefs(projectId)
        for (const ref of Object.values(refs)) {
          if (credentialState[ref]?.writable === false) continue
          await removeCredential(credentials, ref)
        }
      }

      const nextRefs = normalizedProjects.flatMap(project => Object.values(credentialRefs(project.projectId)))
      setCredentialState(await describeCredentials(credentials, nextRefs))
      setCredentialError(undefined)
      setProjects(normalizedProjects.map((project, index) => ({
        ...project,
        draftKey: `saved-${project.projectId}-${index}`,
        clientId: '',
        clientSecret: '',
        persisted: true,
      })))
      setEvidenceDirectory(evidenceDirectory.trim())
      setApiBaseUrl(origin)
      setRemovedProjectIds([])
      setDirty(false)
      setSaved(true)
    } catch (error) {
      const message = errorMessage(error)
      const refs = projects.flatMap(project => validProjectId(project.projectId)
        ? Object.values(credentialRefs(project.projectId.trim()))
        : [])
      if (credentialWriteAttempted || projectSettingsSaved) {
        try {
          const refreshedState = await describeCredentials(credentials, refs)
          setCredentialState(current => ({ ...current, ...refreshedState }))
          setCredentialError(undefined)
        } catch {
          setCredentialError('配置写入后无法读取最新凭据状态；请重新打开设置卡核对。')
        }
      }
      if (projectSettingsSaved) {
        setFailure(`项目设置已保存，但旧凭据清理未完成：${message}`)
      } else if (credentialWritesComplete && credentialWriteAttempted) {
        setFailure(`项目凭据已保存，但普通设置未全部保存：${message}`)
      } else if (credentialWriteAttempted) {
        setFailure(`凭据写入结果可能不完整，请核对项目状态后再试：${message}`)
      } else {
        setFailure(message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.card} data-testid="geo-workbench-card">
      <button
        className={styles.header}
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded(current => !current)}
      >
        <span className={styles.brandMark} aria-hidden="true">G</span>
        <span className={styles.heading}>
          <span className={styles.title}>{t('title')}</span>
          <span className={styles.description}>{t('description')}</span>
        </span>
        <span className={`${styles.badge} ${endpointReady && configuredProjectCount > 0 ? styles.badgeReady : ''}`}>
          <span className={styles.stateDot} />{statusCopy}
        </span>
        <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`} aria-hidden="true">⌄</span>
      </button>

      {expanded ? (
        <div className={styles.body}>
          <div className={styles.route} aria-label="GEO 按项目使用独立身份">
            <div className={styles.routeNode}><span className={styles.routeIcon}>G</span><span>GEO 项目</span></div>
            <span className={styles.routeLine} />
            <div className={styles.routeNode}><span className={styles.routeIcon}>↔</span><span>项目凭据</span></div>
            <span className={styles.routeLine} />
            <div className={styles.routeNode}><span className={styles.routeIcon}>B</span><span>独立 Bearer</span></div>
            <span className={styles.routeState}>{statusCopy}</span>
          </div>

          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>GEO 服务</h3>
            <Field
              label="GEO 服务 IP / 域名"
              hint="只填协议、主机和端口；插件会自动补上 /geo 与 /auth/machine-token。内网地址也必须走 HTTPS。"
              value={apiBaseUrl}
              placeholder="https://192.168.2.110:端口"
              testId="geo-api-base-url"
              disabled={busy || !snapshot.writable}
              onChange={(next) => { markDirty(); setApiBaseUrl(next) }}
            />
            <div className={styles.twoColumns}>
              <Field
                label="资料投递目录（可选）"
                hint="用于 geo_upload_evidence；只允许该目录下的指定文档类型。"
                value={evidenceDirectory}
                placeholder="D:\\geo-evidence"
                testId="geo-evidence-directory"
                disabled={busy || !snapshot.writable}
                onChange={(next) => { markDirty(); setEvidenceDirectory(next) }}
              />
              <Field
                label="请求超时（秒）"
                type="number"
                min={1}
                max={120}
                value={timeoutSeconds}
                testId="geo-timeout-seconds"
                disabled={busy || !snapshot.writable}
                onChange={(next) => { markDirty(); setTimeoutSeconds(next) }}
              />
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h3 className={styles.sectionTitle}>项目授权</h3>
                <p className={styles.sectionHint}>每个项目使用唯一 Client ID 和机器客户端；绑定的服务账号应只加入对应 GEO 项目。</p>
              </div>
              <button className={styles.ghostButton} type="button" disabled={busy || !snapshot.writable} onClick={addProject}>＋ 添加项目</button>
            </div>

            {projects.length === 0 ? (
              <div className={styles.emptyProjects}>添加一个项目 ID，并填写为该项目创建的 Client ID 和 Secret。</div>
            ) : projects.map((project, index) => {
              const projectId = project.projectId.trim()
              const refs = validProjectId(projectId) ? credentialRefs(projectId) : undefined
              const idInfo = refs ? credentialState[refs.clientId] : undefined
              const secretInfo = refs ? credentialState[refs.clientSecret] : undefined
              const bothConfigured = idInfo?.configured === true && secretInfo?.configured === true
              const externalManaged = idInfo?.writable === false || secretInfo?.writable === false
              return (
                <div className={styles.projectCard} key={project.draftKey} data-testid={`geo-project-row-${index}`}>
                  <div className={styles.projectHeader}>
                    <div className={styles.projectTitleGroup}>
                      <span className={styles.projectIcon}>{index + 1}</span>
                      <div>
                        <strong className={styles.projectTitle}>{project.name.trim() || (projectId ? `项目 ${projectId}` : '新项目授权')}</strong>
                        <span className={styles.projectSubtitle}>{bothConfigured ? '凭据已配置 · Bearer 将按此项目单独换取' : '待配置项目凭据'}</span>
                      </div>
                    </div>
                    <div className={styles.credentialStates}>
                      <CredentialState label="Client ID" info={idInfo} />
                      <CredentialState label="Client Secret" info={secretInfo} />
                    </div>
                  </div>
                  <div className={styles.twoColumns}>
                    <Field
                      label="项目 ID"
                      hint="工具调用时选择同一个项目 ID，插件据此挑选凭据。"
                      value={project.projectId}
                      placeholder="例如 2100100790457094145"
                      testId={`geo-project-id-${index}`}
                      disabled={busy || !snapshot.writable || project.persisted}
                      onChange={(next) => updateProject(project.draftKey, 'projectId', next)}
                    />
                    <Field
                      label="项目名称（可选）"
                      value={project.name ?? ''}
                      placeholder="例如 品牌 A 官网增长"
                      testId={`geo-project-name-${index}`}
                      disabled={busy || !snapshot.writable}
                      onChange={(next) => updateProject(project.draftKey, 'name', next)}
                    />
                  </div>
                  <div className={styles.twoColumns}>
                    <Field
                      label="该项目 Client ID"
                      hint="由 GEO 管理员为该项目的专用服务账号创建。"
                      value={project.clientId}
                      placeholder={idInfo?.configured ? '已安全保存；留空表示不更改' : '例如 geo-project-210010'}
                      testId={`geo-project-client-id-${index}`}
                      autoComplete="off"
                      disabled={busy || idInfo?.writable === false}
                      onChange={(next) => updateProject(project.draftKey, 'clientId', next)}
                    />
                    <Field
                      label="该项目 Client Secret"
                      hint="写入 DSH Credentials，只写入、不回显；轮换时重新输入。"
                      value={project.clientSecret}
                      type="password"
                      placeholder={secretInfo?.configured ? '已安全保存；留空表示不更改' : '32–72 位，不含空格'}
                      testId={`geo-project-client-secret-${index}`}
                      autoComplete="new-password"
                      disabled={busy || secretInfo?.writable === false}
                      onChange={(next) => updateProject(project.draftKey, 'clientSecret', next)}
                    />
                  </div>
                  {confirmRemoveKey === project.draftKey ? (
                    <div className={styles.confirmRow}>
                      <span>移除该项目后，保存时会清理可写的 DSH 凭据。继续吗？</span>
                      <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => confirmRemoveProject(project)}>确认移除</button>
                      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => setConfirmRemoveKey(undefined)}>取消</button>
                    </div>
                  ) : (
                    <button className={styles.clearButton} type="button" disabled={busy} onClick={() => setConfirmRemoveKey(project.draftKey)}>移除项目</button>
                  )}
                  {externalManaged ? <p className={styles.hint}>外部管理的凭据需在其来源处轮换或清理。</p> : null}
                </div>
              )
            })}

            <div className={styles.tokenNote}>
              <span className={styles.tokenGlyph}>B</span>
              <span><strong>Bearer Token 按项目自动换取</strong><br />调用时用 projectId 选择对应机器客户端；短期令牌按项目缓存在插件进程内存中，页面、Skill 和工具结果不会显示令牌原文。</span>
            </div>
            {credentialError ? <p className={styles.inlineError}>{credentialError}</p> : null}
          </div>

          <div className={styles.footer}>
            <button
              className={styles.primaryButton}
              type="button"
              data-testid="geo-settings-save"
              disabled={busy || !snapshot.writable || !dirty}
              onClick={() => { void save() }}
            >
              {busy ? '保存中…' : '保存配置'}
            </button>
            {saved ? <span className={styles.success}>项目配置已保存；首次调用时会换取该项目的 Bearer Token。</span> : null}
            {failure ? <span className={styles.failure} role="alert">{failure}</span> : null}
          </div>

          <p className={styles.compliance}>
            每次调用 <code>geo_api</code> 和 <code>geo_connection_status</code> 都要指定项目 ID；保存后可按项目运行 <code>geo_connection_status</code> 验证机器账号，不执行 GEO 业务写入。
          </p>
        </div>
      ) : null}
    </section>
  )
}
