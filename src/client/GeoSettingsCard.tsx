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
type ProjectDraft = ProjectSettings & { draftKey: string; apiToken: string; persisted: boolean }
type SettingsValue = { apiBaseUrl?: string; evidenceDirectory?: string; timeoutMs?: number; projects?: ProjectSettings[]; restrictTools?: boolean }
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
    throw new Error('GEO 项目令牌要求 HTTPS；内网 IP 也需要配置 HTTPS。')
  }
  return url.origin
}

function validProjectId(value: string): boolean {
  return /^[1-9]\d{0,19}$/.test(value.trim())
}

function credentialRefs(projectId: string): { apiToken: string } {
  return { apiToken: `GEO_PROJECT_${projectId}_API_TOKEN` }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '保存失败，请检查 DSH 配置服务。'
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
  if (!result.ok) throw new Error(result.error?.message || 'DSH 拒绝保存项目令牌。')
}

async function removeCredential(credentials: CredentialRemote, ref: string): Promise<void> {
  const result = await credentials.unset(ref)
  if (!result.ok) throw new Error(result.error?.message || 'DSH 拒绝删除项目令牌。')
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
  const [isolationBusy, setIsolationBusy] = useState(false)
  const [isolationError, setIsolationError] = useState<string | undefined>()
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
      setFailure('当前 DSH 没有提供凭据设置接口，无法安全保存项目令牌。')
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
    const credentialWrites: Array<{ ref: string; value: string }> = []
    for (const project of projects) {
      const projectId = project.projectId.trim()
      if (!validProjectId(projectId)) {
        setFailure('每个项目都要填写有效的 GEO 项目 ID（正整数）。')
        return
      }
      if (seenProjectIds.has(projectId)) {
        setFailure(`项目 ID ${projectId} 重复了；每个项目只能配置一个令牌。`)
        return
      }
      seenProjectIds.add(projectId)
      if (project.name.trim().length > 80) {
        setFailure(`项目 ${projectId} 的名称不能超过 80 个字符。`)
        return
      }

      const refs = credentialRefs(projectId)
      const apiToken = project.apiToken.trim()
      const tokenConfigured = credentialState[refs.apiToken]?.configured === true
      if (!apiToken && !tokenConfigured) {
        setFailure(`请粘贴为项目 ${projectId} 创建的项目 API 令牌。`)
        return
      }
      if (apiToken && credentialState[refs.apiToken]?.writable === false) {
        setFailure(`项目 ${projectId} 的令牌由外部管理，无法在此覆盖。`)
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
        apiToken: '',
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

  // 工具级隔离开关：即时生效（直接写本行的 restrictTools），不走「保存配置」那条表单流程。
  // 开启 = 本实例所有 Agent 只看得见 GEO 工具；关闭 = 立刻恢复本实例原有工具。
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
              hint="只填协议、主机和端口；业务请求直接携带项目令牌。内网地址也必须走 HTTPS。"
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
                <p className={styles.sectionHint}>每个 DSH 项目绑定一个 GEO 项目令牌；令牌在 GEO 项目档案中创建、限时并可随时撤销。</p>
              </div>
              <button className={styles.ghostButton} type="button" disabled={busy || !snapshot.writable} onClick={addProject}>＋ 添加项目</button>
            </div>

            {projects.length === 0 ? (
              <div className={styles.emptyProjects}>添加项目 ID，并粘贴在 GEO 对应项目档案中创建的 API 令牌。</div>
            ) : projects.map((project, index) => {
              const projectId = project.projectId.trim()
              const refs = validProjectId(projectId) ? credentialRefs(projectId) : undefined
              const tokenInfo = refs ? credentialState[refs.apiToken] : undefined
              const tokenConfigured = tokenInfo?.configured === true
              const externalManaged = tokenInfo?.writable === false
              return (
                <div className={styles.projectCard} key={project.draftKey} data-testid={`geo-project-row-${index}`}>
                  <div className={styles.projectHeader}>
                    <div className={styles.projectTitleGroup}>
                      <span className={styles.projectIcon}>{index + 1}</span>
                      <div>
                        <strong className={styles.projectTitle}>{project.name.trim() || (projectId ? `项目 ${projectId}` : '新项目授权')}</strong>
                        <span className={styles.projectSubtitle}>{tokenConfigured ? '项目令牌已安全保存 · GEO 会校验绑定项目' : '待配置项目令牌'}</span>
                      </div>
                    </div>
                    <div className={styles.credentialStates}>
                      <CredentialState label="项目 API 令牌" info={tokenInfo} />
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
                  <Field
                    label="该项目 API 令牌"
                    hint="从 GEO 项目档案复制创建时显示的一次性令牌；写入 DSH Credentials 后不回显。轮换时在 GEO 撤销旧令牌并粘贴新令牌。"
                    value={project.apiToken}
                    type="password"
                    placeholder={tokenInfo?.configured ? '已安全保存；留空表示不更改' : '粘贴该项目的 geop_ 令牌'}
                    testId={`geo-project-api-token-${index}`}
                    autoComplete="new-password"
                    disabled={busy || tokenInfo?.writable === false}
                    onChange={(next) => updateProject(project.draftKey, 'apiToken', next)}
                  />
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
              <span><strong>Bearer 按项目绑定</strong><br />每个项目的令牌单独保存在 DSH Credentials。连接检查会确认令牌实际绑定的 GEO 项目；页面、Skill 和工具结果不会显示令牌原文。</span>
            </div>
            {credentialError ? <p className={styles.inlineError}>{credentialError}</p> : null}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h3 className={styles.sectionTitle}>运行隔离</h3>
                <p className={styles.sectionHint}>
                  开启后，本 DSH 实例里所有 Agent 只看得见这 5 个 GEO 工具（shell、文件、浏览器等一律隐藏）；
                  关闭则立刻恢复本实例原有的全部工具。开关即时生效，不需要重启。
                </p>
              </div>
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
            <p className={styles.hint}>
              {restrictTools
                ? '隔离生效中：本实例只暴露 GEO 的 5 个工具。'
                : '隔离已关闭：GEO 工具与其它工具同时可用，此时 GEO 令牌与通用工具处在同一个环境里。'}
              切换后立即写入，没变化就完全退出 DSH 再启动；需要与日常环境彻底隔开时改用独立实例（换 home 必须重启，做法见说明书）。
            </p>
            {isolationError ? <p className={styles.inlineError}>{isolationError}</p> : null}
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
            {saved ? <span className={styles.success}>项目配置已保存；可运行连接检查确认令牌与 GEO 项目匹配。</span> : null}
            {failure ? <span className={styles.failure} role="alert">{failure}</span> : null}
          </div>

          <p className={styles.compliance}>
            <code>geo_api</code> 与 <code>geo_connection_status</code> 每次都要指定项目 ID，检测与报告按人工节点确认。
            <strong>说明书</strong>：DSH 里输入 <code>/geo-workflow</code>，或读
            <code>&lt;DSH_HOME&gt;\skills\geo-workflow\references\operator-guide.md</code>。
          </p>
        </div>
      ) : null}
    </section>
  )
}
