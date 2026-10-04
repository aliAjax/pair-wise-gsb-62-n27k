import { createReducer, on } from '@ngrx/store'
import type { Anomaly, AuditEntry, MergeReceipt, OfflineReviewItem, RawReading, SyncBatch, TailingsDataset } from '../domain'
import { seedDataset } from '../data/seed'
import { TailingsActions } from './tailings.actions'

export interface TailingsState {
  dataset: TailingsDataset
  loading: boolean
  error: string
  selectedAnomalyId: string
  keyword: string
  status: Anomaly['status'] | '全部'
}

export const initialTailingsState: TailingsState = {
  dataset: structuredClone(seedDataset),
  loading: false,
  error: '',
  selectedAnomalyId: seedDataset.anomalies[0]?.id ?? '',
  keyword: '',
  status: '全部'
}

let idSeed = 50
const audit = (entityId: string, action: string, operator: string, detail: string, batchId = '', outcome = ''): AuditEntry => ({
  id: `AUD-${Date.now()}-${idSeed++}`, entityId, action, operator, detail, createdAt: new Date().toISOString(), batchId, outcome
})

const hasOpenConflict = (anomaly: Anomaly): boolean => anomaly.pendingConflicts.some((item) => item.status === '待核对')
const hasStaleReview = (anomaly: Anomaly): boolean => anomaly.fieldReviews.some((item) => item.confirmStatus === '待重新确认')

const mergeItem = (dataset: TailingsDataset, batch: SyncBatch, item: OfflineReviewItem): MergeReceipt => {
  const base = { itemId: item.id, anomalyId: item.anomalyId, team: item.team }
  const anomaly = dataset.anomalies.find((entry) => entry.id === item.anomalyId)
  if (!anomaly) return { ...base, outcome: '重复忽略', detail: '异常不存在，跳过该复核项' }
  const alreadyMerged = anomaly.fieldReviews.some((review) => review.sourceItemId === item.id) || anomaly.pendingConflicts.some((conflict) => conflict.itemId === item.id)
  if (alreadyMerged) return { ...base, outcome: '重复忽略', detail: '该离线复核项已合并，不重复记录' }
  if (item.baseVersion < anomaly.version) {
    const latest = anomaly.fieldReviews[0]
    const sameAsLatest = latest && latest.observed === item.observed && latest.evidence === item.evidence && latest.reassessment === item.reassessment
    if (sameAsLatest) return { ...base, outcome: '重复忽略', detail: '与先到的复核改法一致，不再重复登记' }
    anomaly.pendingConflicts.unshift({
      id: `CF-${Date.now()}-${idSeed++}`, itemId: item.id, anomalyId: anomaly.id, batchId: batch.id, team: item.team, inspector: item.inspector,
      observed: item.observed, evidence: item.evidence, reassessment: item.reassessment, recordedAt: item.recordedAt, status: '待核对', resolvedBy: '', resolvedAt: ''
    })
    anomaly.version += 1
    dataset.audit.unshift(audit(anomaly.id, '离线复核待核对', item.inspector, `${item.team}基于V${item.baseVersion}记录，当前V${anomaly.version}已有先到改法，待核对`, batch.id, '待核对'))
    return { ...base, outcome: '待核对', detail: `异常已推进到V${anomaly.version}，后到改法登记为待核对冲突` }
  }
  anomaly.fieldReviews.unshift({
    id: `FR-${Date.now()}-${idSeed++}`, inspector: item.inspector, arrivedAt: item.recordedAt, observed: item.observed, evidence: item.evidence,
    reassessment: item.reassessment, version: anomaly.fieldReviews.length + 1, team: item.team, batchId: batch.id, sourceItemId: item.id,
    confirmStatus: '有效', confirmedAt: new Date().toISOString()
  })
  if (anomaly.status === '待现场复核') anomaly.status = '原因调查中'
  anomaly.version += 1
  dataset.audit.unshift(audit(anomaly.id, '合并离线复核', item.inspector, `${item.team}回连上传：${item.reassessment}`, batch.id, '已接受'))
  return { ...base, outcome: '已接受', detail: `按异常当前版本V${anomaly.version}合并入库` }
}

const applyBatch = (dataset: TailingsDataset, record: SyncBatch, failAfter: number): void => {
  let applied = 0
  for (const item of record.items) {
    if (record.appliedItemIds.includes(item.id)) continue
    if (failAfter >= 0 && applied >= failAfter) {
      record.status = '部分失败'
      record.failureReason = `坝区链路中断，第${applied + 1}项起写入失败`
      dataset.audit.unshift(audit(record.id, '批次写入中断', record.team, `已写入${record.appliedItemIds.length}项，剩余${record.items.length - record.appliedItemIds.length}项待断点恢复`, record.id, '部分失败'))
      return
    }
    record.results.unshift(mergeItem(dataset, record, item))
    record.appliedItemIds.push(item.id)
    applied += 1
  }
  record.status = '已完成'
  record.failureReason = ''
}

export const tailingsReducer = createReducer(
  initialTailingsState,
  on(TailingsActions.loadDataset, (state) => ({ ...state, loading: true, error: '' })),
  on(TailingsActions.loadDatasetSuccess, (state, { dataset }) => ({ ...state, dataset, loading: false, selectedAnomalyId: dataset.anomalies[0]?.id ?? '' })),
  on(TailingsActions.loadDatasetFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(TailingsActions.submitFieldReview, (state, { anomalyId, review }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !review.observed || !review.evidence || !review.reassessment) return state
    anomaly.fieldReviews.unshift({ ...review, version: anomaly.fieldReviews.length + 1 })
    anomaly.status = '原因调查中'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '提交现场复核', review.inspector, review.reassessment))
    return { ...state, dataset }
  }),
  on(TailingsActions.addExpertOpinion, (state, { anomalyId, opinion }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !opinion.content) return state
    anomaly.opinions.unshift(opinion)
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '补充专业意见', opinion.specialist, `${opinion.conclusion}：${opinion.content}`))
    return { ...state, dataset }
  }),
  on(TailingsActions.saveDispositionPlan, (state, { anomalyId, plan }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !plan.owner || !plan.deadline || !plan.conditions) return state
    if (anomaly.severity === '重大' && hasOpenConflict(anomaly)) return state
    anomaly.plan = { ...plan, approvedBy: '', approvedAt: '' }
    anomaly.status = '待负责人审批'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '提交处置方案', '当前用户', `${plan.action}，责任方${plan.owner}`))
    return { ...state, dataset }
  }),
  on(TailingsActions.approvePlan, (state, { anomalyId, approver, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    if (anomaly.severity === '重大' && !anomaly.plan.emergencyLinked) return state
    if (anomaly.severity === '重大' && hasOpenConflict(anomaly)) return state
    if (hasStaleReview(anomaly)) return state
    anomaly.plan.approvedBy = approver
    anomaly.plan.approvedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '审批处置方案', approver, note || '同意执行'))
    return { ...state, dataset }
  }),
  on(TailingsActions.closeAnomaly, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly || !anomaly.plan.approvedBy || !anomaly.fieldReviews.length || !note.trim()) return state
    if (anomaly.severity === '重大' && hasOpenConflict(anomaly)) return state
    if (hasStaleReview(anomaly)) return state
    anomaly.status = '已关闭'
    anomaly.closedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '关闭异常', anomaly.plan.approvedBy, note))
    return { ...state, dataset }
  }),
  on(TailingsActions.createEmergencyLink, (state, { anomalyId, note }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    if (!anomaly) return state
    anomaly.plan.emergencyLinked = true
    anomaly.status = '应急联动'
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '启动应急联动', '值班负责人', note))
    return { ...state, dataset }
  }),
  on(TailingsActions.uploadOfflineBatch, (state, { batch, failAfter }) => {
    const dataset = structuredClone(state.dataset)
    const existing = dataset.syncBatches.find((item) => item.id === batch.id)
    if (existing) {
      if (existing.status === '已完成') return state
      applyBatch(dataset, existing, -1)
      return { ...state, dataset }
    }
    if (!batch.items.length) return state
    const record: SyncBatch = { ...batch, status: '已完成', failureReason: '', appliedItemIds: [], results: [] }
    applyBatch(dataset, record, failAfter)
    dataset.syncBatches.unshift(record)
    dataset.audit.unshift(audit(record.id, '上传离线复核批次', record.team, `批次共${record.items.length}项，${record.status}`, record.id, record.status === '已完成' ? '已接受' : '部分失败'))
    return { ...state, dataset }
  }),
  on(TailingsActions.resumeOfflineBatch, (state, { batchId }) => {
    const dataset = structuredClone(state.dataset)
    const record = dataset.syncBatches.find((item) => item.id === batchId)
    if (!record || record.status === '已完成') return state
    applyBatch(dataset, record, -1)
    dataset.audit.unshift(audit(record.id, '断点恢复批次', record.team, `从断点补写剩余复核项，批次${record.status}`, record.id, '已接受'))
    return { ...state, dataset }
  }),
  on(TailingsActions.resolveConflict, (state, { anomalyId, conflictId, decision, operator }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    const conflict = anomaly?.pendingConflicts.find((item) => item.id === conflictId)
    if (!anomaly || !conflict || conflict.status !== '待核对') return state
    conflict.status = decision
    conflict.resolvedBy = operator
    conflict.resolvedAt = new Date().toISOString()
    if (decision === '已采纳') {
      anomaly.fieldReviews.unshift({
        id: `FR-${Date.now()}-${idSeed++}`, inspector: conflict.inspector, arrivedAt: conflict.recordedAt, observed: conflict.observed,
        evidence: conflict.evidence, reassessment: conflict.reassessment, version: anomaly.fieldReviews.length + 1, team: conflict.team,
        batchId: conflict.batchId, sourceItemId: conflict.itemId, confirmStatus: '有效', confirmedAt: new Date().toISOString()
      })
    }
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, decision === '已采纳' ? '采纳冲突复核' : '驳回冲突复核', operator, `${conflict.team}：${conflict.reassessment}`, conflict.batchId, decision))
    return { ...state, dataset }
  }),
  on(TailingsActions.reviseReading, (state, { readingId, value, reason }) => {
    const dataset = structuredClone(state.dataset)
    const source = dataset.readings.find((item) => item.id === readingId)
    if (!source || !Number.isFinite(value)) return state
    const revised: RawReading = { ...source, id: `RD-${Date.now()}-${idSeed++}`, value, capturedAt: new Date().toISOString(), quality: '有效', supersedesId: source.id }
    dataset.readings.unshift(revised)
    const point = dataset.points.find((item) => item.id === source.pointId)
    if (point) { point.currentValue = value; point.lastInspectionAt = revised.capturedAt }
    dataset.audit.unshift(audit(source.pointId, '订正原始读数', '数据中心', `${source.value}→${value}${source.unit}，${reason || '设备校准订正'}，原读数保留`))
    for (const anomaly of dataset.anomalies) {
      if (anomaly.triggerReadingId !== readingId || anomaly.status === '已关闭') continue
      anomaly.triggerReadingId = revised.id
      anomaly.version += 1
      if (anomaly.plan.approvedBy) continue
      let stale = 0
      for (const review of anomaly.fieldReviews) {
        if (review.confirmStatus === '有效') { review.confirmStatus = '待重新确认'; stale += 1 }
      }
      if (stale) dataset.audit.unshift(audit(anomaly.id, '引用读数变化', '数据中心', `触发读数订正为${value}${source.unit}，${stale}条未批准结论失效，待重新确认`, '', '待重新确认'))
    }
    return { ...state, dataset }
  }),
  on(TailingsActions.reconfirmReview, (state, { anomalyId, reviewId, operator }) => {
    const dataset = structuredClone(state.dataset)
    const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
    const review = anomaly?.fieldReviews.find((item) => item.id === reviewId)
    if (!anomaly || !review || review.confirmStatus !== '待重新确认') return state
    review.confirmStatus = '有效'
    review.confirmedAt = new Date().toISOString()
    anomaly.version += 1
    dataset.audit.unshift(audit(anomalyId, '重新确认结论', operator, `复核V${review.version}结论对照新读数重新确认有效`, '', '已接受'))
    return { ...state, dataset }
  }),
  on(TailingsActions.selectAnomaly, (state, { anomalyId }) => ({ ...state, selectedAnomalyId: anomalyId })),
  on(TailingsActions.updateKeyword, (state, { keyword }) => ({ ...state, keyword })),
  on(TailingsActions.updateStatus, (state, { status }) => ({ ...state, status: status as TailingsState['status'] })),
  on(TailingsActions.addAudit, (state, { entry }) => ({ ...state, dataset: { ...state.dataset, audit: [entry, ...state.dataset.audit] } })),
  on(TailingsActions.resetDemo, () => ({ ...initialTailingsState, dataset: structuredClone(seedDataset), selectedAnomalyId: seedDataset.anomalies[0].id }))
)
