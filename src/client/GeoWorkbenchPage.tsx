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
  lastOp: string
}
type StageView = { stages?: StageRow[] }
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

function stageActivity(view: StageView | undefined): number {
  return (view?.stages ?? []).reduce((total, stage) => total + (stage.calls > 0 ? 1 : 0), 0)
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

/** 流程条：canonical 阶段顺序 + 三态；无 GEO 活动时给出一句空态。 */
export function GeoStageStepper(props: { view?: StageView }): ReactNode {
  const { view } = props
  const stages = view?.stages ?? []
  const active = stages.find(stage => stage.status === 'active')
  if (stages.length === 0 || stages.every(stage => stage.calls === 0)) {
    return <p className={styles.idle}>会话里还没有 GEO 活动；AI 开始调用 GEO 工具后，这里会显示流程进度。</p>
  }
  return (
    <div className={styles.wrap}>
      <ol className={styles.track}>
        {stages.map(stage => (
          <li
            key={stage.key}
            className={`${styles.step} ${styles[stage.status === 'done' ? 'stepDone' : stage.status === 'active' ? 'stepActive' : 'stepPending']}`}
            title={stage.lastOp ? `${stage.label} · ${stage.lastOp}` : stage.label}
          >
            <span className={styles.dot}>{stage.status === 'done' ? '✓' : ''}</span>
            <span className={styles.stepLabel}>{stage.label}</span>
          </li>
        ))}
      </ol>
      <p className={styles.caption}>
        {active
          ? `进行中：${active.label}${active.lastOp ? ` · ${active.lastOp}` : ''}`
          : '当前阶段已完成；AI 进入下一步时会自动更新。'}
      </p>
    </div>
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
