import { createReducer, on } from '@ngrx/store'
import type { Anomaly, AuditEntry, TailingsDataset } from '../domain'
import { seedDataset } from '../data/seed'
import {
  applyConflictResolution,
  applyReviewInput,
  approvalBlockReason,
  closeBlockReason,
  itemToInput,
  latestReadingFor,
  recordReadingChange,
  reconfirmAnomaly,
  type ReviewInput
} from '../domain/rules'
import { TailingsActions } from './tailings.actions'

export interface TailingsState {
  dataset: TailingsDataset
  loading: boolean
  error: string
  notice: string
  selectedAnomalyId: string
  keyword: string
  status: Anomaly['status'] | '全部'
}

export const initialTailingsState: TailingsState = {
  dataset: structuredClone(seedDataset),
  loading: false,
  error: '',
  notice: '',
  selectedAnomalyId: seedDataset.anomalies[0]?.id ?? '',
  keyword: '',
  status: '全部'
}

let idSeed = 100
const makeId = (prefix: string): string => `${prefix}-${Date.now()}-${idSeed++}`
const makeAudit = (base: Omit<AuditEntry, 'id' | 'createdAt'>): AuditEntry => ({
  id: makeId('AUD'),
  createdAt: new Date().toISOString(),
  ...base
})

const withNotice = (state: TailingsState, dataset: TailingsDataset, notice: string): TailingsState => ({ ...state, dataset, notice })

export const tailingsReducer = createReducer(
  initialTailingsState,
  on(TailingsActions.loadDataset, (state) => ({ ...state, loading: true, error: '' })),
  on(TailingsActions.loadDatasetSuccess, (state, { dataset }) => ({ ...state, dataset, loading: false, notice: '', selectedAnomalyId: dataset.anomalies[0]?.id ?? '' })),
  on(TailingsActions.loadDatasetFailure, (state, { error }) => ({ ...state, loading: false, error })),

  on(TailingsActions.submitFieldReview, (state, { anomalyId, review, crew, basedOnReadingId, planSuggestion }) => {
    const dataset = structuredClone(state.dataset)
    const input: ReviewInput = {
      itemId: review.id,
      anomalyId,
      crew,
      batchId: 'online',
      observed: review.observed,
      evidence: review.evidence,
      reassessment: review.reassessment,
      planSuggestion: planSuggestion ?? '',
      basedOnReadingId,
      capturedOfflineAt: review.arrivedAt
    }
    const result = applyReviewInput(dataset, input, makeAudit, makeId)
    if (result.duplicate) return state
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (anomaly && anomaly.status === '待现场复核') anomaly.status = '原因调查中'
    const notice =
      `复核已合并：采纳${result.mergedFieldCount}个字段` +
      (result.conflictedFieldCount ? `，${result.conflictedFieldCount}个不同改法已挂起待核对` : '') +
      (result.wasStale ? '；引用读数已变化，结论待重新确认' : '')
    return withNotice(state, dataset, notice)
  }),

  on(TailingsActions.addExpertOpinion, (state, { anomalyId, opinion }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !opinion.content) return state
    anomaly.opinions.unshift(opinion)
    anomaly.version += 1
    dataset.audit.unshift(makeAudit({ entityId: anomalyId, action: '补充专业意见', operator: opinion.specialist, detail: `${opinion.conclusion}：${opinion.content}` }))
    return { ...state, dataset }
  }),

  on(TailingsActions.saveDispositionPlan, (state, { anomalyId, plan }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !plan.owner || !plan.deadline || !plan.conditions) return state
    const latest = latestReadingFor(dataset.readings, anomaly.pointId)
    const open = anomaly.conflicts.filter((conflict) => conflict.outcome === '待核对')
    if (anomaly.severity === '重大' && open.length) {
      return withNotice(state, state.dataset, `重大异常尚有${open.length}个待核对冲突，冲突核对完成前不能送负责人审批`)
    }
    anomaly.plan = {
      ...plan,
      approvedBy: '',
      approvedAt: '',
      batchId: 'online',
      crew: plan.crew ?? '甲班',
      basedOnReadingId: latest?.id ?? anomaly.triggerReadingId,
      confirmStatus: '已确认'
    }
    anomaly.status = '待负责人审批'
    anomaly.version += 1
    dataset.audit.unshift(makeAudit({ entityId: anomalyId, action: '提交处置方案', operator: '当前用户', detail: `${plan.action}，责任方${plan.owner}，送负责人审批`, batchId: 'online', conflictResult: open.length ? '待核对' : '保留先到', confirmStatus: '已确认' }))
    return withNotice(state, dataset, '处置方案已送负责人审批')
  }),

  on(TailingsActions.queueOfflineBatch, (state, { batch }) => {
    const dataset = structuredClone(state.dataset)
    dataset.syncBatches.unshift(structuredClone(batch))
    return withNotice(state, dataset, `离线批次 ${batch.id} 已登记，含 ${batch.items.length} 个待写复核项`)
  }),

  on(TailingsActions.armWriteFailure, (state, { batchId }) => {
    const dataset = structuredClone(state.dataset)
    const batch = dataset.syncBatches.find((item) => item.id === batchId)
    if (!batch) return state
    batch.failNextWrite = true
    return withNotice(state, dataset, `已模拟批次 ${batchId} 下一条写入失败，用于验证断点恢复`)
  }),

  on(TailingsActions.syncBatch, (state, { batchId }) => {
    const dataset = structuredClone(state.dataset)
    const batch = dataset.syncBatches.find((item) => item.id === batchId)
    if (!batch) return state

    let wrote = 0
    let duplicated = 0
    let conflicted = 0
    let failed = 0
    for (const item of batch.items) {
      // 断点恢复：已成功的复核项不再重写
      if (item.status === '写入成功') continue
      if (batch.failNextWrite) {
        batch.failNextWrite = false
        item.status = '写入失败'
        failed += 1
        batch.status = '部分失败'
        dataset.audit.unshift(
          makeAudit({
            entityId: item.anomalyId,
            action: '批次写入失败',
            operator: item.crew,
            detail: `批次${batch.id}在复核项${item.id}处中断，后续复核项保留待补写`,
            batchId: batch.id
          })
        )
        break // 本批断点：剩余项留待恢复
      }
      const result = applyReviewInput(dataset, itemToInput(batch.id, item), makeAudit, makeId)
      item.status = '写入成功'
      if (result.duplicate) duplicated += 1
      else {
        wrote += 1
        conflicted += result.conflictedFieldCount
      }
    }

    const remaining = batch.items.filter((item) => item.status !== '写入成功').length
    if (remaining === 0) {
      batch.status = '已完成'
      batch.syncedAt = new Date().toISOString()
    } else if (batch.status !== '部分失败') {
      batch.status = '同步中'
    }
    const parts: string[] = []
    if (wrote) parts.push(`补写${wrote}个复核项`)
    if (duplicated) parts.push(`${duplicated}项重复上传命中幂等，未增加审计记录`)
    if (conflicted) parts.push(`${conflicted}个不同改法挂起待核对`)
    if (failed) parts.push(`1项写入失败，已从断点保留，可再次同步只补未写项`)
    else if (remaining) parts.push(`剩余${remaining}项待同步`)
    return withNotice(state, dataset, `批次 ${batchId}：${parts.join('；') || '全部复核项此前已写入'}`)
  }),

  on(TailingsActions.resolveConflict, (state, { anomalyId, conflictId, outcome, operator }) => {
    const dataset = structuredClone(state.dataset)
    applyConflictResolution(dataset, anomalyId, conflictId, outcome, operator, makeAudit)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    const open = anomaly?.conflicts.filter((conflict) => conflict.outcome === '待核对').length ?? 0
    return withNotice(state, dataset, `冲突已核对（${outcome}）` + (open ? `，仍有${open}个待核对` : '，未决冲突已清零，可继续审批流程'))
  }),

  on(TailingsActions.registerReading, (state, { pointId, reading }) => {
    const dataset = structuredClone(state.dataset)
    const change = recordReadingChange(dataset, pointId, () => reading, makeAudit)
    const point = dataset.points.find((item) => item.id === pointId)
    if (point) {
      point.currentValue = reading.value
      point.lastInspectionAt = reading.capturedAt
    }
    return withNotice(
      state,
      dataset,
      `新读数 ${reading.id} 已写入` + (change.invalidated.length ? `，${change.invalidated.join('、')}等未批准结论已失效，须重新确认` : '')
    )
  }),

  on(TailingsActions.reconfirmConclusions, (state, { anomalyId, operator }) => {
    const dataset = structuredClone(state.dataset)
    reconfirmAnomaly(dataset, anomalyId, operator, makeAudit)
    return withNotice(state, dataset, '已基于最新读数重新确认结论')
  }),

  on(TailingsActions.approvePlan, (state, { anomalyId, approver, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    const latest = latestReadingFor(dataset.readings, anomaly.pointId)
    const reason = approvalBlockReason(anomaly, latest?.id ?? anomaly.triggerReadingId)
    if (reason) return withNotice(state, state.dataset, `审批被阻断：${reason}`)
    anomaly.plan.approvedBy = approver
    anomaly.plan.approvedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(makeAudit({ entityId: anomalyId, action: '审批处置方案', operator: approver, detail: note || '同意执行', batchId: anomaly.plan.batchId, conflictResult: '保留先到', confirmStatus: anomaly.plan.confirmStatus }))
    return withNotice(state, dataset, '负责人审批通过')
  }),

  on(TailingsActions.closeAnomaly, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    const latest = latestReadingFor(dataset.readings, anomaly.pointId)
    const reason = closeBlockReason(anomaly, latest?.id ?? anomaly.triggerReadingId)
    if (reason) return withNotice(state, state.dataset, `关闭被阻断：${reason}`)
    anomaly.status = '已关闭'
    anomaly.closedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(makeAudit({ entityId: anomalyId, action: '关闭异常', operator: anomaly.plan.approvedBy, detail: note, batchId: anomaly.plan.batchId, conflictResult: '保留先到', confirmStatus: '已确认' }))
    return withNotice(state, dataset, '异常已关闭')
  }),

  on(TailingsActions.createEmergencyLink, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    anomaly.plan.emergencyLinked = true
    anomaly.status = '应急联动'
    anomaly.version += 1
    dataset.audit.unshift(makeAudit({ entityId: anomalyId, action: '启动应急联动', operator: '值班负责人', detail: note }))
    return withNotice(state, dataset, '已启动应急联动')
  }),

  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status: status as TailingsState['status'] })),
  on(TailingsActions.addAudit, (state, { entry }) => ({ ...state, dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] } })),
  on(TailingsActions.resetDemo, () => ({ ...initialTailingsState, dataset: structuredClone(seedDataset), notice: '演示数据已恢复', selectedAnomalyId: seedDataset.anomalies[0].id }))
)
