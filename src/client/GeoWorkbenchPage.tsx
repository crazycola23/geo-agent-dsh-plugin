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
}
type StageView = { stages?: StageRow[]; projects?: string[] }
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
  pending: 'stepPending',
  active: 'stepActive',
  done: 'stepDone',
  failed: 'stepFailed',
  unknown: 'stepUnknown',
}

/** 阶段说明：把只读感知与真实写操作分开写，别让 GET 也读成「已完成」。 */
function stageCaption(stage: StageRow): string {
  const parts: string[] = []
  if (stage.writes !== undefined) parts.push(`写 ${stage.writes}`)
  if (stage.reads) parts.push(`只读 ${stage.reads}`)
  return parts.join(' · ')
}

/**
 * 订阅所有可见会话的 geoWorkflow 投影，挑出「正在跑或最近跑过 GEO」的那个。
 * 订阅本身是扇入式的：任何会话的投影变化都会触发一次重新挑选。
 */
function useLatestGeoStage(sessions: SessionsService | undefined): StageView | undefined {
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
  const a = JSON.stringify(left?.stages ?? [])
  const b = JSON.stringify(right?.stages ?? [])
  return a === b
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

/** 流程条：canonical 阶段顺序 + 五态；无 GEO 活动时给出一句空态。 */
export function GeoStageStepper(props: { view?: StageView }): ReactNode {
  const { view } = props
  const stages = view?.stages ?? []
  const active = stages.find(stage => stage.status === 'active')
  const failed = stages.find(stage => stage.status === 'failed')
  const unknown = stages.find(stage => stage.status === 'unknown')
  const writes = stages.reduce((total, stage) => total + (stage.writes ?? 0), 0)
  if (stages.length === 0 || stages.every(stage => stage.calls === 0)) {
    return <p className={styles.idle}>会话里还没有 GEO 活动；AI 开始调用 GEO 工具后，这里会显示流程进度。</p>
  }
  return (
    <div className={styles.wrap}>
      <ol className={styles.track}>
        {stages.map(stage => {
          const caption = stageCaption(stage)
          return (
            <li
              key={stage.key}
              className={`${styles.step} ${styles[STATUS_CLASS[stage.status] ?? 'stepPending']}`}
              title={[stage.label, stage.lastOp, caption && `（${caption}）`].filter(Boolean).join(' · ')}
            >
              <span className={styles.dot}>{stage.status === 'done' ? '✓' : stage.status === 'failed' ? '!' : stage.status === 'unknown' ? '?' : ''}</span>
              <span className={styles.stepLabel}>{stage.label}</span>
            </li>
          )
        })}
      </ol>
      {failed ? (
        <p className={styles.caption} data-status="failed">被拒：{failed.label}{failed.lastOp ? ` · ${failed.lastOp}` : ''} — 该阶段未完成，需要人工处理。</p>
      ) : null}
      {!failed && unknown ? (
        <p className={styles.caption} data-status="unknown">待查证：{unknown.label}{unknown.lastOp ? ` · ${unknown.lastOp}` : ''} — 结果未确认，请先核对 GEO 记录再重试。</p>
      ) : null}
      {!failed && !unknown ? (
        <p className={styles.caption}>
          {active
            ? `进行中：${active.label}${active.lastOp ? ` · ${active.lastOp}` : ''}`
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
    </section>
  )
}

/** 主视图页：上半是流程进度，下半是原设置卡。 */
export function GeoWorkbenchPage(props: GeoWorkbenchPageProps): ReactNode {
  const { sessions, ...cardProps } = props
  const view = useLatestGeoStage(sessions)
  return (
    <section className={styles.page}>
      <div className={styles.stepperCard}>
        <h3 className={styles.heading}>GEO 流程进度</h3>
        <GeoStageStepper view={view} />
      </div>
      <GeoSettingsCard {...cardProps} />
    </section>
  )
}
