import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { GeoSettingsCard } from './GeoSettingsCard.tsx'
import type { GeoSettingsCardProps } from './GeoSettingsCard.tsx'
import styles from './geo-workflow.module.css'

type StageRow = {
  key: string
  label: string
  status: string
  calls: number
  reads?: number
  writes?: number
  lastOp: string
  awaitingApproval?: boolean
  rejectionReason?: string
}
type NoteRow = {
  at: number
  seq: number
  stageKey?: string
  stageLabel?: string
  text: string
}
type TokenStatus = {
  projectId: string
  expiresAt: string
  tokenName?: string
  projectName?: string
  authenticated: boolean
  checkedAt: number
}
type StageView = { stages?: StageRow[]; projects?: string[]; notes?: NoteRow[]; tokens?: TokenStatus[] }

/**
 * 令牌状态概要到人读文案：有效期 + 剩余天数 + 临期/过期告警。
 * 数据来自上一次真实校验——没校验过就说没校验过，不猜一个日期出来。
 */
export function tokenSummary(token: TokenStatus | undefined): { text: string; level: 'ok' | 'warn' | 'expired' | 'unknown' } {
  const raw = token?.expiresAt
  if (!raw) return { text: '调用一次连接校验后显示', level: 'unknown' }
  const expires = new Date(raw)
  if (Number.isNaN(expires.getTime())) return { text: '有效期格式无法识别', level: 'unknown' }
  const month = String(expires.getMonth() + 1).padStart(2, '0')
  const day = String(expires.getDate()).padStart(2, '0')
  const date = `${expires.getFullYear()}-${month}-${day}`
  const days = Math.ceil((expires.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { text: `${date} 已过期`, level: 'expired' }
  // 7 天内提前示警：令牌一过期，该项目上所有 GEO 调用都会失败。
  return { text: `${date}（剩 ${days} 天）`, level: days <= 7 ? 'warn' : 'ok' }
}

/** 说明条目的时间戳：只显示到分钟——运营员看的是先后，不是精确到秒。 */
function formatNoteTime(at?: number): string {
  if (typeof at !== 'number' || at <= 0) return ''
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}
type ProjectionStore = {
  subscribe(listener: () => void): () => void
  getSnapshot(): StageView | undefined
}
type SessionSummary = { id?: string; updatedAt?: number; running?: boolean; blank?: boolean }
export type SessionsService = {
  list: {
    getSnapshot(): { byId?: Record<string, SessionSummary> }
    subscribe?(listener: () => void): () => void
  }
  binding(sessionId: string): {
    session?: {
      projections?: {
        faceOf(name: string): ProjectionStore
      }
    }
  } | undefined
}

const PROJECTION_KEY = 'geoWorkflow'
const MAX_BOUND_SESSIONS = 12

export interface GeoWorkbenchPageProps extends GeoSettingsCardProps {
  sessions?: SessionsService
}

export interface GeoSessionProgressViewProps {
  sessionId?: string
  sessions?: SessionsService
}

function stageActivity(view: StageView | undefined): number {
  return (view?.stages ?? []).reduce((total, stage) => total + (stage.calls > 0 ? 1 : 0), 0)
}

const STATUS_CLASS: Record<string, string> = {
  pending: 'cellPending',
  awaiting: 'cellAwaiting',
  active: 'cellActive',
  done: 'cellDone',
  failed: 'cellFailed',
  unknown: 'cellUnknown',
}

/** 状态码 → 网格单元格里的短标签（中文，与 UI 术语一致）。 */
const STATUS_LABEL: Record<string, string> = {
  pending: '待开始',
  awaiting: '等审批',
  active: '进行中',
  done: '已完成',
  failed: '被拒',
  unknown: '待查证',
}

/**
 * 操作名 → 中文业务叫法。进度页面向运营员，不出现 OpenAPI 操作名。
 * 只收 OpsRun 里真正会发生的动作；未命中的不猜、不拆词，直接不显示，
 * 由阶段名承担说明作用（英文标识对使用人群没有信息量）。
 */
const OPERATION_LABEL: Record<string, string> = {
  // 项目
  get_projects_by_projectid: '读取项目档案',
  put_projects_by_projectid: '更新项目档案',
  post_projects_by_projectid_start: '启动项目',
  get_platforms: '读取平台清单',
  get_platform_accounts: '读取客户平台账号',
  // 资料
  get_evidence_sources: '查看资料列表',
  post_evidence_sources_upload: '上传资料',
  post_evidence_sources_retry_parse: '重新解析资料',
  // 事实
  get_fact_revisions: '查看事实库',
  post_facts: '新建事实',
  post_facts_ai_extract: '提取事实候选',
  post_facts_ai_extract_by_runid_retry: '重试事实提取',
  post_facts_ai_extract_by_runid_candidates_batch_confirm: '批量确认事实候选',
  post_facts_ai_extract_by_runid_candidates_by_candidateid_confirm: '确认事实候选',
  post_facts_ai_extract_by_runid_candidates_by_candidateid_reject: '驳回事实候选',
  post_fact_revisions_by_id_confirm: '确认事实',
  post_fact_revisions_by_id_dispute: '标记事实存疑',
  post_fact_revisions_by_id_disable: '停用事实',
  post_fact_revisions_by_id_reenable: '重新启用事实',
  // 内容要素
  post_content_elements: '新建内容要素',
  post_content_elements_ai_extract: '提炼内容要素',
  post_content_elements_by_elementid_ai_split: '拆分内容要素',
  post_content_elements_by_elementid_enabled: '启用/停用内容要素',
  // 问题
  get_questions: '查看问题库',
  post_questions: '新建问题',
  post_questions_by_id_transition: '启用/停用问题',
  post_question_generation_tasks: '发起问题生成',
  post_question_generation_tasks_by_taskid_regenerate: '重新生成问题',
  get_query_panels: '查看问题面板',
  post_query_panels: '新建问题面板',
  post_query_panels_by_panelid_new_version: '问题面板新建版本',
  post_query_panels_by_panelid_freeze: '冻结问题面板',
  // 内容
  get_content_generation_tasks: '查看生成任务',
  post_content_generation_tasks: '创建生成任务',
  post_content_generation_tasks_by_id_execute: '执行内容生成',
  post_content_generation_tasks_by_id_cancel: '取消内容生成',
  put_content_generation_tasks_by_id: '更新生成任务',
  get_article_versions: '查看文章',
  post_article_card_compose: '生成文章卡片',
  // 发布
  get_publish_records: '查看发布记录',
  get_publish_balance: '查询发布账户余额',
  get_media_catalog_resources: '查询媒体目录',
  post_publish_records_preview: '发布预览与报价',
  post_publish_records_preview_from_resource: '按媒体发布预览',
  post_publish_records_confirm: '确认发布',
  post_publish_records_manual: '人工发布',
  post_publish_records_by_id_cancel: '取消发布',
  post_publish_records_by_id_republish: '重新发布',
  post_publish_records_by_id_query_order: '查询发布订单',
  // 检测
  get_detection_plans: '查看检测计划',
  post_detection_plans: '创建检测计划',
  post_detection_plans_by_id_execute: '执行检测计划',
  get_detection_runs_by_planid_progress: '查看检测进度',
  post_detection_runs: '发起检测',
  post_detection_runs_by_runid_pause: '暂停检测',
  post_detection_attempts_by_id_retry: '重试检测项',
  post_detection_attempts_by_id_query_order: '查询检测订单',
  // 报告
  get_run_reports: '查看运行报告',
  get_customer_geo_reports: '查看客户报告',
  post_customer_geo_reports: '生成客户报告',
  post_customer_geo_reports_by_reportid_retry: '重新生成客户报告',
  post_detection_runs_by_runid_customer_geo_reports: '按检测运行生成报告',
  get_report_revisions: '查看报告修订',
  post_report_revisions: '创建报告修订',
  post_report_revisions_by_id_confirm: '确认报告',
  post_report_revisions_by_id_return: '退回报告',
  post_report_revisions_by_id_artifacts_render: '渲染报告产物',
  get_score_snapshots: '查看评分快照',
};

/** 把目录操作名翻成业务叫法；未收录的不显示英文标识。 */
function operationLabel(operation: string | undefined): string {
  if (!operation) return ''
  return OPERATION_LABEL[operation] ?? ''
}

/**
 * 订阅所有可见会话的 geoWorkflow 投影，挑出「正在跑或最近跑过 GEO」的那个。
 * 订阅本身是扇入式的：任何会话的投影变化都会触发一次重新挑选。
 */
export function useLatestGeoStage(sessions: SessionsService | undefined): StageView | undefined {
  const [view, setView] = useState<StageView | undefined>()
  useEffect(() => {
    if (!sessions) return
    const stops = new Map<string, () => void>()
    const reconcile = (): void => {
      const summaries = Object.values(sessions.list.getSnapshot()?.byId ?? {})
        .filter(summary => summary?.blank !== true && typeof summary.id === 'string')
        .sort((left, right) => {
          if ((right.running === true) !== (left.running === true)) return right.running === true ? 1 : -1
          return (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
        })
        .slice(0, MAX_BOUND_SESSIONS)

      for (const [sessionId, stop] of stops) {
        if (!summaries.some(summary => summary.id === sessionId)) {
          stop()
          stops.delete(sessionId)
        }
      }
      for (const summary of summaries) {
        const sessionId = summary.id as string
        if (stops.has(sessionId)) continue
        const store = sessions.binding(sessionId)?.session?.projections?.faceOf(PROJECTION_KEY)
        if (!store) continue
        stops.set(sessionId, store.subscribe(reconcile))
      }

      let best: StageView | undefined
      for (const summary of summaries) {
        const store = sessions.binding(summary.id as string)?.session?.projections?.faceOf(PROJECTION_KEY)
        const candidate = store?.getSnapshot()
        if (candidate && stageActivity(candidate) > 0) {
          best = candidate
          break
        }
      }
      setView(current => (sameStages(current, best) ? current : best))
    }
    const stopList = sessions.list.subscribe?.(reconcile)
    reconcile()
    return () => {
      stopList?.()
      for (const stop of stops.values()) stop()
      stops.clear()
    }
  }, [sessions])
  return view
}

function sameStages(left: StageView | undefined, right: StageView | undefined): boolean {
  if (left === right) return true
  // notes 与 tokens 也必须参与比较：只比 stages 会让「写了一条说明」或
  // 「拿到令牌有效期」这种纯附加更新被判定为无变化，界面不刷新。
  const shape = (view: StageView | undefined): string => JSON.stringify({
    stages: view?.stages ?? [],
    notes: view?.notes ?? [],
    tokens: view?.tokens ?? [],
  })
  return shape(left) === shape(right)
}

/** 订阅单个会话的 geoWorkflow 投影；会话或服务不可用时保持空态。 */
function useSessionGeoStage(sessions: SessionsService | undefined, sessionId: string | undefined): StageView | undefined {
  const [view, setView] = useState<StageView | undefined>()
  useEffect(() => {
    if (!sessions || !sessionId) return
    const store = sessions.binding(sessionId)?.session?.projections?.faceOf(PROJECTION_KEY)
    if (!store) return
    setView(store.getSnapshot())
    return store.subscribe(() => setView(store.getSnapshot()))
  }, [sessions, sessionId])
  return view
}

type PendingQuestion = { callId?: string; questions?: Array<{ question?: string; header?: string }>; state?: string }
type UserQuestionsView = { active?: PendingQuestion[] } | undefined

/** 订阅同一会话的 userQuestions 投影，返回等待用户答复的提问批次。 */
function useSessionPendingQuestions(sessions: SessionsService | undefined, sessionId: string | undefined): PendingQuestion[] {
  const [active, setActive] = useState<PendingQuestion[]>([])
  useEffect(() => {
    if (!sessions || !sessionId) return
    const store = sessions.binding(sessionId)?.session?.projections?.faceOf('userQuestions')
    if (!store) return
    const reconcile = (): void => setActive(store.getSnapshot()?.active ?? [])
    reconcile()
    return store.subscribe(reconcile)
  }, [sessions, sessionId])
  return active
}

/** 阶段网格：canonical 顺序 + 五态 + 写入/只读分列计数；无 GEO 活动时给一句空态。 */
export function GeoStageStepper(props: { view?: StageView }): ReactNode {
  const { view } = props
  const stages = view?.stages ?? []
  const active = stages.find(stage => stage.status === 'active')
  const failed = stages.find(stage => stage.status === 'failed')
  const unknown = stages.find(stage => stage.status === 'unknown')
  const awaiting = stages.find(stage => stage.status === 'awaiting')
  const writes = stages.reduce((total, stage) => total + (stage.writes ?? 0), 0)
  const reads = stages.reduce((total, stage) => total + (stage.reads ?? 0), 0)
  const pendingApprovals = stages.filter(stage => stage.status === 'awaiting').length
  const doneCount = stages.filter(stage => stage.status === 'done').length
  // 「当前」= 最该看的那一格：等审批优先（需要人介入），其次进行中，
  // 再次被拒/待查证（要处理），最后才是最近完成的。
  const focusStage = stages.find(stage => stage.status === 'awaiting')
    ?? stages.find(stage => stage.status === 'active')
    ?? stages.find(stage => stage.status === 'failed')
    ?? stages.find(stage => stage.status === 'unknown')
    ?? stages.filter(stage => stage.status === 'done').pop()
  const notes = view?.notes ?? []
  if (stages.length === 0 || (stages.every(stage => stage.calls === 0) && notes.length === 0)) {
    return <p className={styles.idle}>会话里还没有 GEO 活动；AI 开始调用 GEO 工具后，这里会显示流程进度。</p>
  }
  return (
    <div className={styles.wrap}>
      <div className={styles.overview}>
        <div className={styles.totals}>
          <span className={styles.totalItem}><strong>{writes}</strong> 写操作</span>
          <span className={styles.totalItem}><strong>{reads}</strong> 只读探测</span>
          {pendingApprovals > 0 ? (
            <span className={`${styles.totalItem} ${styles.totalAlert}`}><strong>{pendingApprovals}</strong> 项等审批</span>
          ) : null}
        </div>
        {/* 八段流程条：网格给逐格细节，这一条给「走到哪、卡在哪」的整体感。
            每段带 title，鼠标停上去能看到是哪个阶段。 */}
        <div className={styles.rail} role="img" aria-label={`流程进度：已完成 ${doneCount} / ${stages.length}`}>
          {stages.map(stage => (
            <span
              key={stage.key}
              className={styles.railSegment}
              data-status={stage.status}
              title={`${stage.label} · ${STATUS_LABEL[stage.status] ?? stage.status}`}
            />
          ))}
        </div>
        <div className={styles.railSummary}>
          <span>已完成 {doneCount} / {stages.length}</span>
          {focusStage ? <span>当前：{focusStage.label}</span> : null}
        </div>
      </div>
      <ol className={styles.grid}>
        {stages.map((stage, index) => {
          const writesForStage = stage.writes ?? 0
          const readsForStage = stage.reads ?? 0
          const opLabel = operationLabel(stage.lastOp)
          return (
            <li
              key={stage.key}
              className={`${styles.cell} ${styles[STATUS_CLASS[stage.status] ?? 'cellPending']}`}
              // 入场 stagger：同排 40ms 递进，建立阅读顺序；只作用一次，
              // 且 transform/opacity 不触发布局。reduced-motion 下 CSS 直接关掉。
              style={{ animationDelay: `${(index % 4) * 40}ms` }}
              title={opLabel || stage.label}
            >
              <span className={styles.cellIndex}>{index + 1}</span>
              <span className={styles.cellBody}>
                <span className={styles.cellTop}>
                  <span className={styles.cellName}>{stage.label}</span>
                  {/* 色点让同一列扫一眼就能分辨状态，比逐字读标签快。 */}
                  <span className={styles.cellStatus}>
                    <span className={styles.cellDot} />
                    {STATUS_LABEL[stage.status] ?? stage.status}
                  </span>
                </span>
                <span className={styles.cellCounts}>
                  {writesForStage > 0 ? <span className={styles.countWrite}>写 {writesForStage}</span> : null}
                  {readsForStage > 0 ? <span className={styles.countRead}>只读 {readsForStage}</span> : null}
                  {writesForStage === 0 && readsForStage === 0 ? <span className={styles.countNone}>—</span> : null}
                </span>
                {stage.status === 'awaiting' ? (
                  <span className={styles.cellHint}>等待你在审批弹窗中确认</span>
                ) : null}
                {stage.status === 'failed' && stage.rejectionReason ? (
                  <span className={styles.cellReason} title={stage.rejectionReason}>{stage.rejectionReason}</span>
                ) : null}
                {opLabel ? <span className={styles.cellOp}>{opLabel}</span> : null}
              </span>
            </li>
          )
        })}
      </ol>
      {notes.length > 0 ? (
        <section className={styles.noteSection}>
          <h3 className={styles.noteHeading}>进度说明</h3>
          <ol className={styles.noteList}>
            {notes.map((note, index) => (
              <li key={`${note.seq}-${index}`} className={styles.noteItem}>
                <time className={styles.noteTime}>{formatNoteTime(note.at)}</time>
                {note.stageLabel ? <span className={styles.noteStage}>{note.stageLabel}</span> : null}
                <span className={styles.noteText}>{note.text}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {awaiting ? (
        <p className={styles.caption} data-status="awaiting">等审批：{awaiting.label}{operationLabel(awaiting.lastOp) ? ` · ${operationLabel(awaiting.lastOp)}` : ''} — 请在审批弹窗中确认后继续。</p>
      ) : null}
      {!awaiting && failed ? (
        <p className={styles.caption} data-status="failed">被拒：{failed.label}{operationLabel(failed.lastOp) ? ` · ${operationLabel(failed.lastOp)}` : ''}{failed.rejectionReason ? ` — ${failed.rejectionReason}` : ''}</p>
      ) : null}
      {!awaiting && !failed && unknown ? (
        <p className={styles.caption} data-status="unknown">待查证：{unknown.label}{operationLabel(unknown.lastOp) ? ` · ${operationLabel(unknown.lastOp)}` : ''} — 结果未确认，请先核对 GEO 记录再重试。</p>
      ) : null}
      {!awaiting && !failed && !unknown ? (
        <p className={styles.caption}>
          {active
            ? `进行中：${active.label}${operationLabel(active.lastOp) ? ` · ${operationLabel(active.lastOp)}` : ''}`
            : writes > 0
              ? '本轮写操作已收敛；AI 进入下一步时会自动更新。'
              : '目前只有只读探测，尚未发生写操作。'}
        </p>
      ) : null}
    </div>
  )
}

/** 会话视图标签页：与「轨迹」同级，展示当前会话的 GEO 流程进度与待答复提问。 */
export function GeoSessionProgressView(props: GeoSessionProgressViewProps): ReactNode {
  const { sessionId, sessions } = props
  const view = useSessionGeoStage(sessions, sessionId)
  const pending = useSessionPendingQuestions(sessions, sessionId)
  const firstQuestion = pending[0]?.questions?.[0]
  return (
    <section className={styles.page}>
      <div className={styles.pageScroll}>
        <div className={styles.pageContent}>
          {pending.length > 0 ? (
            <div className={styles.pendingBanner} data-testid="geo-pending-questions">
              <span className={styles.pendingDot} aria-hidden="true">⏳</span>
              <span>
                {pending.length > 1
                  ? `AI 有 ${pending.length} 批问题等待你的答复，请在对话中作答。`
                  : `AI 正在等待你的答复${firstQuestion?.question ? `：「${firstQuestion.question}」` : '，请在对话中作答。'} 答复后才会继续。`}
              </span>
            </div>
          ) : null}
          <div className={styles.stepperCard}>
            <h3 className={styles.heading}>GEO 流程进度</h3>
            <GeoStageStepper view={view} />
          </div>
        </div>
      </div>
    </section>
  )
}

/** 主视图页：三层滚动容器（照官方 TaskManagerPage），上半流程进度、下半设置卡。 */
export function GeoWorkbenchPage(props: GeoWorkbenchPageProps): ReactNode {
  const { sessions, ...cardProps } = props
  const view = useLatestGeoStage(sessions)
  return (
    <section className={styles.page}>
      <div className={styles.pageScroll}>
        <div className={styles.pageContent}>
          <div className={styles.stepperCard}>
            <h3 className={styles.heading}>GEO 流程进度</h3>
            <GeoStageStepper view={view} />
          </div>
          <GeoSettingsCard {...cardProps} />
        </div>
      </div>
    </section>
  )
}
