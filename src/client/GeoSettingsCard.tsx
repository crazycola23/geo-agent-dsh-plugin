import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { en } from './locales.ts'
// 凭据引用规则与项目编号规则必须与插件运行时同源（两处各写一份曾互为漂移隐患）。
import { normalizeProjectId, projectCredentialRefs } from '../project-context.js'
// 令牌有效期只有 GEO 服务端知道，客户端读不到凭据值也不能调宿主工具；
// 这里复用工作台页的会话投影订阅，拿上一次真实校验留下的令牌状态。
import { tokenSummary, useLatestGeoStage } from './GeoWorkbenchPage.tsx'
import type { SessionsService, TokenStatus } from './GeoWorkbenchPage.tsx'
import styles from './geo-settings.module.css'

type CredentialInfo = { configured?: boolean; writable?: boolean; source?: string }
type RemoteResult<T = unknown> = { ok: true; value: T } | { ok: false; error?: { message?: string } }
type CredentialRemote = {
  describe(refs: string[]): Promise<RemoteResult<Record<string, CredentialInfo>>>
  set(ref: string, value: string): Promise<RemoteResult>
  unset(ref: string): Promise<RemoteResult>
}
type ProjectSettings = { projectId: string; name?: string }
type ProjectDraft = ProjectSettings & { draftKey: string; apiToken: string; persisted: boolean }
type PolicyKey = 'factConfirmPolicy' | 'contentPrepPolicy' | 'contentGenerationPolicy' | 'detectionPolicy' | 'reportPolicy'
type SettingsValue = {
  apiBaseUrl?: string
  apiBasePath?: string
  evidenceDirectory?: string
  exportDirectory?: string
  timeoutMs?: number
  projects?: ProjectSettings[]
  restrictTools?: boolean
  factConfirmPolicy?: string
  contentPrepPolicy?: string
  contentGenerationPolicy?: string
  detectionPolicy?: string
  reportPolicy?: string
}
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
  /** 软依赖：宿主没提供时，令牌有效期一栏退化为「未校验」，其余照常。 */
  sessions?: SessionsService
}

function normalizeBasePathInput(input: string): string {
  const value = input.trim()
  if (value === '' || value === '/') return ''
  if (!value.startsWith('/')) throw new Error('转发路径前缀要以 / 开头，例如 /prod-api。')
  if (value.includes('//') || value.includes('\\') || value.includes('?') || value.includes('#')) {
    throw new Error('转发路径前缀只能是一段路径，不要带查询参数、片段或反斜杠。')
  }
  return value.replace(/\/+$/, '')
}

function normalizeOrigin(input: string): string {
  const value = input.trim()
  if (!value) throw new Error('请填写 GEO 服务地址。')
  const url = new URL(value.includes('://') ? value : `https://${value}`)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('请填写协议、地址和端口，不要填写路径、用户名或查询参数。')
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('项目令牌要求使用 HTTPS 地址；内网地址也必须套上 HTTPS。')
  }
  return url.origin
}

/** 仅做布尔化：合法项目编号（正整数）与运行时同一套正则来源。 */
function validProjectId(value: string): boolean {
  return normalizeProjectId(value) !== undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '保存失败，请检查 DSH 的配置服务是否正常。'
}

function draftsFrom(projects: ProjectSettings[] | undefined): ProjectDraft[] {
  return (projects ?? []).map((project, index) => ({
    draftKey: `saved-${project.projectId}-${index}`,
    projectId: project.projectId,
    name: project.name ?? '',
    apiToken: '',
    persisted: true,
  }))
}

// 审批档位域，与插件 POLICY_DOMAINS 一一对应；显示层归一化也保持同一口径：
// 只有显式 'agent' 才是自动档，其余任何值都按「询问」处理。
const POLICY_DOMAINS: Array<{ key: PolicyKey; name: string; scope: string }> = [
  { key: 'factConfirmPolicy', name: '事实确认', scope: '事实修订与提取候选的确认、停用、存疑' },
  { key: 'contentPrepPolicy', name: '内容准备', scope: '问题、问题面板、内容要素、事实提取发起' },
  { key: 'contentGenerationPolicy', name: '内容生成', scope: '生成任务与文章卡片，会产生模型调用费用' },
  { key: 'detectionPolicy', name: '检测', scope: '检测计划、运行与重试；预算仍由服务端硬校验' },
  { key: 'reportPolicy', name: '报告', scope: '报告生成、确认、渲染与按规则恢复' },
]

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
  if (!result.ok) throw new Error(result.error?.message || '读不到 DSH 里保存的凭据状态。')
  return result.value
}

async function writeCredential(credentials: CredentialRemote, ref: string, value: string): Promise<void> {
  const result = await credentials.set(ref, value)
  if (!result.ok) throw new Error(result.error?.message || 'DSH 拒绝保存这个项目的访问令牌。')
}

async function removeCredential(credentials: CredentialRemote, ref: string): Promise<void> {
  const result = await credentials.unset(ref)
  if (!result.ok) throw new Error(result.error?.message || 'DSH 拒绝删除这个项目的访问令牌。')
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
  const { scope, useSnapshot, t, credentials, sessions } = props
  const snapshot = useSnapshot()
  const value = snapshot.value ?? {}
  // 令牌有效期按项目取：数据来自该会话里最近一次 geo_connection_status 的真实结果。
  const geoView = useLatestGeoStage(sessions)
  const tokenByProject = new Map<string, TokenStatus>(
    (geoView?.tokens ?? []).map(token => [token.projectId, token]),
  )
  const [expanded, setExpanded] = useState(true)
  const [apiBaseUrl, setApiBaseUrl] = useState(value.apiBaseUrl ?? '')
  const [apiBasePath, setApiBasePath] = useState(value.apiBasePath ?? '')
  const [evidenceDirectory, setEvidenceDirectory] = useState(value.evidenceDirectory ?? '')
  const [exportDirectory, setExportDirectory] = useState(value.exportDirectory ?? '')
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
  const [isolationBusy, setIsolationBusy] = useState(false)
  const [isolationError, setIsolationError] = useState<string | undefined>()
  const [tab, setTab] = useState<'connection' | 'runtime'>('connection')
  const [policyBusyKey, setPolicyBusyKey] = useState<PolicyKey | undefined>()
  const [policyError, setPolicyError] = useState<string | undefined>()
  const nextDraftId = useRef(0)

  useEffect(() => {
    if (dirty) return
    setApiBaseUrl(value.apiBaseUrl ?? '')
    setApiBasePath(value.apiBasePath ?? '')
    setEvidenceDirectory(value.evidenceDirectory ?? '')
    setExportDirectory(value.exportDirectory ?? '')
    setTimeoutSeconds(String(Math.round((value.timeoutMs ?? 30_000) / 1_000)))
    setProjects(draftsFrom(value.projects))
  }, [dirty, value.apiBaseUrl, value.apiBasePath, value.evidenceDirectory, value.exportDirectory, value.timeoutMs, value.projects])

  const refsInUse = projects.flatMap(project => validProjectId(project.projectId)
    ? Object.values(projectCredentialRefs(project.projectId.trim()))
    : [])
  const refsKey = [...new Set(refsInUse)].sort().join('|')

  useEffect(() => {
    if (!credentials) {
      setCredentialError('当前 DSH 没有提供凭据设置入口。')
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
    const refs = projectCredentialRefs(project.projectId.trim())
    return credentialState[refs.apiToken]?.configured === true
  }).length
  const endpointReady = apiBaseUrl.trim().length > 0
  const statusCopy = endpointReady && configuredProjectCount > 0 ? `待验证 · ${configuredProjectCount} 个项目` : '待配置'

  const markDirty = (): void => {
    setDirty(true)
    setSaved(false)
    setFailure(undefined)
  }

  const updateProject = (draftKey: string, field: keyof Pick<ProjectDraft, 'projectId' | 'name' | 'apiToken'>, nextValue: string): void => {
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
      apiToken: '',
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
      setFailure('当前 DSH 没有提供凭据设置入口，无法安全保存访问令牌。')
      return
    }
    let origin: string
    let gatewayPrefix: string
    try {
      origin = normalizeOrigin(apiBaseUrl)
      gatewayPrefix = normalizeBasePathInput(apiBasePath)
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
    const credentialWrites: Array<{ ref: string; value: string }> = []
    for (const project of projects) {
      const projectId = project.projectId.trim()
      if (!validProjectId(projectId)) {
        setFailure('每个项目都要填写有效的项目编号（正整数）。')
        return
      }
      if (seenProjectIds.has(projectId)) {
        setFailure(`项目编号 ${projectId} 重复了；每个项目只能配一个令牌。`)
        return
      }
      seenProjectIds.add(projectId)
      if (project.name.trim().length > 80) {
        setFailure(`项目 ${projectId} 的名称不能超过 80 个字符。`)
        return
      }

      const refs = projectCredentialRefs(projectId)
      const apiToken = project.apiToken.trim()
      const tokenConfigured = credentialState[refs.apiToken]?.configured === true
      if (!apiToken && !tokenConfigured) {
        setFailure(`请粘贴为项目 ${projectId} 创建的访问令牌。`)
        return
      }
      if (apiToken && credentialState[refs.apiToken]?.writable === false) {
        setFailure(`项目 ${projectId} 的访问令牌由外部管理，不能在这里覆盖。`)
        return
      }
      if (apiToken) credentialWrites.push({ ref: refs.apiToken, value: apiToken })
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
      await scope.set('apiBasePath', gatewayPrefix)
      await scope.set('evidenceDirectory', evidenceDirectory.trim())
      await scope.set('exportDirectory', exportDirectory.trim())
      await scope.set('timeoutMs', seconds * 1_000)
      await scope.set('projects', normalizedProjects)
      projectSettingsSaved = true

      const savedIds = new Set(normalizedProjects.map(project => project.projectId))
      const idsToClear = removedProjectIds.filter(projectId => !savedIds.has(projectId))
      for (const projectId of idsToClear) {
        const refs = projectCredentialRefs(projectId)
        for (const ref of Object.values(refs)) {
          if (credentialState[ref]?.writable === false) continue
          await removeCredential(credentials, ref)
        }
      }

      const nextRefs = normalizedProjects.flatMap(project => Object.values(projectCredentialRefs(project.projectId)))
      setCredentialState(await describeCredentials(credentials, nextRefs))
      setCredentialError(undefined)
      setProjects(normalizedProjects.map((project, index) => ({
        ...project,
        draftKey: `saved-${project.projectId}-${index}`,
        apiToken: '',
        persisted: true,
      })))
      setEvidenceDirectory(evidenceDirectory.trim())
      setExportDirectory(exportDirectory.trim())
      setApiBaseUrl(origin)
      setApiBasePath(gatewayPrefix)
      setRemovedProjectIds([])
      setDirty(false)
      setSaved(true)
    } catch (error) {
      const message = errorMessage(error)
      const refs = projects.flatMap(project => validProjectId(project.projectId)
        ? Object.values(projectCredentialRefs(project.projectId.trim()))
        : [])
      if (credentialWriteAttempted || projectSettingsSaved) {
        try {
          const refreshedState = await describeCredentials(credentials, refs)
          setCredentialState(current => ({ ...current, ...refreshedState }))
          setCredentialError(undefined)
        } catch {
          setCredentialError('配置写入之后读不到最新凭据状态；请重新打开设置卡核对。')
        }
      }
      if (projectSettingsSaved) {
        setFailure(`项目设置已保存，但旧凭据的清理没做完：${message}`)
      } else if (credentialWritesComplete && credentialWriteAttempted) {
        setFailure(`项目凭据已保存，但普通设置没全部保存：${message}`)
      } else if (credentialWriteAttempted) {
        setFailure(`凭据写入结果可能不完整，请核对项目状态后再试：${message}`)
      } else {
        setFailure(message)
      }
    } finally {
      setBusy(false)
    }
  }

  // 工具隔离开关：即时生效（直接写本行的 restrictTools），不走「保存配置」那条表单流程。
  // 开启 = 本实例所有智能体只看得见 GEO 工具；关闭 = 立刻恢复本实例原有工具。
  const restrictTools = value.restrictTools !== false
  const setRestriction = async (next: boolean): Promise<void> => {
    setIsolationBusy(true)
    setIsolationError(undefined)
    try {
      await scope.set('restrictTools', next)
    } catch (error) {
      setIsolationError(errorMessage(error))
    } finally {
      setIsolationBusy(false)
    }
  }

  // 审批档位：与隔离开关同一交互模式，写入即生效；只有显式 'agent' 视为自动档。
  const policyValue = (key: PolicyKey): 'ask' | 'agent' => (value[key] === 'agent' ? 'agent' : 'ask')
  const setPolicy = async (key: PolicyKey, next: 'ask' | 'agent'): Promise<void> => {
    setPolicyBusyKey(key)
    setPolicyError(undefined)
    try {
      await scope.set(key, next)
    } catch (error) {
      setPolicyError(errorMessage(error))
    } finally {
      setPolicyBusyKey(undefined)
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
        <span className={styles.title}>{t('title')}</span>
        <span className={`${styles.badge} ${endpointReady && configuredProjectCount > 0 ? styles.badgeReady : ''}`}>
          <span className={styles.stateDot} />{statusCopy}
        </span>
        <span className={`${styles.chevron} ${expanded ? styles.chevronOpen : ''}`} aria-hidden="true">⌄</span>
      </button>

      {expanded ? (
        <div className={styles.body}>
          <div className={styles.tabs} role="tablist" data-testid="geo-settings-tabs">
            <button
              className={tab === 'connection' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              type="button"
              role="tab"
              aria-selected={tab === 'connection'}
              data-testid="geo-tab-connection"
              onClick={() => setTab('connection')}
            >连接</button>
            <button
              className={tab === 'runtime' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              type="button"
              role="tab"
              aria-selected={tab === 'runtime'}
              data-testid="geo-tab-runtime"
              onClick={() => setTab('runtime')}
            >运行</button>
          </div>

          {tab === 'connection' ? (
            <>
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>GEO 服务</h3>
            <Field
              label="GEO 服务地址"
              hint="只填协议、地址和端口"
              value={apiBaseUrl}
              placeholder="https://192.168.2.110:端口"
              testId="geo-api-base-url"
              disabled={busy || !snapshot.writable}
              onChange={(next) => { markDirty(); setApiBaseUrl(next) }}
            />
            <Field
              label="资料投递目录"
              hint="只有这个目录下的文档可以上传。"
              value={evidenceDirectory}
              placeholder="D:\\geo-evidence"
              testId="geo-evidence-directory"
              disabled={busy || !snapshot.writable}
              onChange={(next) => { markDirty(); setEvidenceDirectory(next) }}
            />
            <Field
              label="文章导出目录"
              hint="把稿件导出成 .md 文件的地方；留空即用默认目录（DSH 数据目录下的 geo-articles）"
              value={exportDirectory}
              placeholder="默认：DSH 数据目录下的 geo-articles"
              testId="geo-export-directory"
              disabled={busy || !snapshot.writable}
              onChange={(next) => { markDirty(); setExportDirectory(next) }}
            />
            <div className={styles.twoColumns}>
              <Field
                label="转发路径前缀"
                hint="服务地址前还有一层转发路径时填它，直接访问就留空"
                value={apiBasePath}
                placeholder="/prod-api"
                testId="geo-api-base-path"
                disabled={busy || !snapshot.writable}
                onChange={(next) => { markDirty(); setApiBasePath(next) }}
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
              </div>
              <button className={styles.ghostButton} type="button" disabled={busy || !snapshot.writable} onClick={addProject}>＋ 添加项目</button>
            </div>

            {projects.length === 0 ? (
              <div className={styles.emptyProjects}>添加项目编号与该项目的访问令牌。</div>
            ) : projects.map((project, index) => {
              const projectId = project.projectId.trim()
              const refs = validProjectId(projectId) ? projectCredentialRefs(projectId) : undefined
              const tokenInfo = refs ? credentialState[refs.apiToken] : undefined
              const externalManaged = tokenInfo?.writable === false
              const expiry = tokenSummary(tokenByProject.get(projectId))
              return (
                <div className={styles.projectCard} key={project.draftKey} data-testid={`geo-project-row-${index}`}>
                  <div className={styles.projectHeader}>
                    <div className={styles.projectTitleGroup}>
                      <span className={styles.projectIcon}>{index + 1}</span>
                      <strong className={styles.projectTitle}>{project.name.trim() || (projectId ? `项目 ${projectId}` : '新项目授权')}</strong>
                    </div>
                    <div className={styles.credentialStates}>
                      <CredentialState label="项目访问令牌" info={tokenInfo} />
                    </div>
                  </div>
                  <div className={styles.twoColumns}>
                    <Field
                      label="项目编号"
                      hint="AI 跑任务时会用同一个项目编号。"
                      value={project.projectId}
                      placeholder="例如 2100100790457094145"
                      testId={`geo-project-id-${index}`}
                      disabled={busy || !snapshot.writable || project.persisted}
                      onChange={(next) => updateProject(project.draftKey, 'projectId', next)}
                    />
                    <Field
                      label="项目名称"
                      value={project.name ?? ''}
                      placeholder="例如 品牌 A 官网增长"
                      testId={`geo-project-name-${index}`}
                      disabled={busy || !snapshot.writable}
                      onChange={(next) => updateProject(project.draftKey, 'name', next)}
                    />
                  </div>
                  <Field
                    label="该项目访问令牌"
                    hint="保存后不再显示；换新令牌时先在 GEO 撤销旧的，再粘贴新的。"
                    value={project.apiToken}
                    type="password"
                    placeholder={tokenInfo?.configured ? '已安全保存；留空表示不更改' : '粘贴该项目的访问令牌'}
                    testId={`geo-project-api-token-${index}`}
                    autoComplete="new-password"
                    disabled={busy || tokenInfo?.writable === false}
                    onChange={(next) => updateProject(project.draftKey, 'apiToken', next)}
                  />
                  {/* 有效期来自 GEO 服务端的上一次真实校验；没校验过就明说「未校验」，
                      不推一个日期出来——令牌过期会让该项目上所有 GEO 调用失效。 */}
                  <div
                    className={styles.tokenExpiry}
                    data-level={expiry.level}
                    data-testid={`geo-project-token-expiry-${index}`}
                  >
                    <span className={styles.tokenExpiryLabel}>令牌有效期</span>
                    <span className={styles.tokenExpiryValue}>{expiry.text}</span>
                  </div>
                  {confirmRemoveKey === project.draftKey ? (
                    <div className={styles.confirmRow}>
                      <span>移除该项目后，保存时会一并清理已保存的访问令牌。继续吗？</span>
                      <button className={styles.dangerButton} type="button" disabled={busy} onClick={() => confirmRemoveProject(project)}>确认移除</button>
                      <button className={styles.ghostButton} type="button" disabled={busy} onClick={() => setConfirmRemoveKey(undefined)}>取消</button>
                    </div>
                  ) : (
                    <button className={styles.clearButton} type="button" disabled={busy} onClick={() => setConfirmRemoveKey(project.draftKey)}>移除项目</button>
                  )}
                  {externalManaged ? <p className={styles.hint}>这份凭据由外部管理，请到它的来源处更换或清理。</p> : null}
                </div>
              )
            })}

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
            {saved ? <span className={styles.success}>配置已保存</span> : null}
            {failure ? <span className={styles.failure} role="alert">{failure}</span> : null}
          </div>
            </>
          ) : (
            <>
          <div className={styles.section}>
            <div className={styles.sectionHeading}>
              <h3 className={styles.sectionTitle}>运行隔离</h3>
              <label className={styles.switch}>
                <input
                  className={styles.switchInput}
                  type="checkbox"
                  role="switch"
                  checked={restrictTools}
                  disabled={isolationBusy || !snapshot.writable}
                  data-testid="geo-restrict-tools"
                  onChange={(event) => { void setRestriction(event.target.checked) }}
                />
                <span className={`${styles.switchTrack} ${restrictTools ? styles.switchTrackOn : ''}`} aria-hidden="true">
                  <span className={styles.switchThumb} />
                </span>
                <span className={styles.switchLabel}>{restrictTools ? '已开启 · 仅 GEO 工具' : '已关闭 · 保留全部工具'}</span>
              </label>
            </div>
            {isolationError ? <p className={styles.inlineError}>{isolationError}</p> : null}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeading}>
              <h3 className={styles.sectionTitle}>审批档位</h3>
            </div>
            {POLICY_DOMAINS.map(({ key, name, scope }) => {
              const current = policyValue(key)
              const pending = policyBusyKey !== undefined || !snapshot.writable
              return (
                <div className={styles.policyRow} key={key} data-testid={`geo-policy-${key}`}>
                  <div className={styles.policyMeta}>
                    <span className={styles.policyName}>{name}</span>
                    <span className={styles.policyScope}>{scope}</span>
                  </div>
                  <div className={styles.segmented} role="group" aria-label={`${name}审批档位`}>
                    <button
                      className={current === 'ask' ? `${styles.segmentButton} ${styles.segmentButtonActive}` : styles.segmentButton}
                      type="button"
                      aria-pressed={current === 'ask'}
                      data-testid={`geo-policy-${key}-ask`}
                      disabled={pending}
                      onClick={() => { void setPolicy(key, 'ask') }}
                    >询问</button>
                    <button
                      className={current === 'agent' ? `${styles.segmentButton} ${styles.segmentButtonActive}` : styles.segmentButton}
                      type="button"
                      aria-pressed={current === 'agent'}
                      data-testid={`geo-policy-${key}-agent`}
                      disabled={pending}
                      onClick={() => { void setPolicy(key, 'agent') }}
                    >自动</button>
                  </div>
                </div>
              )
            })}
            <p className={styles.hint}>「自动」= 这类写入交给 AI 自行判断执行；发布确认类操作永远需要人工确认。</p>
            {policyError ? <p className={styles.inlineError}>{policyError}</p> : null}
          </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}