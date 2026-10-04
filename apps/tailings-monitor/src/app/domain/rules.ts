import type {
  Anomaly,
  AuditEntry,
  ConfirmStatus,
  Crew,
  FieldConflict,
  OfflineReviewItem,
  RawReading,
  ReviewFieldKey,
  TailingsDataset
} from './models'
import { reviewFieldLabels } from './models'

export interface ReviewInput {
  itemId: string
  anomalyId: string
  crew: Crew
  batchId: string
  observed: string
  evidence: string
  reassessment: string
  planSuggestion: string
  basedOnReadingId: string
  capturedOfflineAt: string
}

const reviewFields: ReviewFieldKey[] = ['observed', 'evidence', 'reassessment', 'planSuggestion']

export const latestReadingFor = (readings: RawReading[], pointId: string): RawReading | undefined =>
  readings
    .filter((reading) => reading.pointId === pointId)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0]

export const openConflicts = (anomaly: Anomaly): FieldConflict[] =>
  anomaly.conflicts.filter((conflict) => conflict.outcome === '待核对')

export const hasOpenConflict = (anomaly: Anomaly): boolean => openConflicts(anomaly).length > 0

export const staleConclusions = (anomaly: Anomaly, latestReadingId: string): { source: string; confirmStatus?: ConfirmStatus }[] => {
  const stale: { source: string; confirmStatus?: ConfirmStatus }[] = []
  anomaly.fieldReviews.forEach((review) => {
    if (review.confirmStatus === '待重新确认' && (!review.basedOnReadingId || review.basedOnReadingId !== latestReadingId)) {
      stale.push({ source: `复核${review.inspector} V${review.version}`, confirmStatus: review.confirmStatus })
    }
  })
  if (
    anomaly.plan.confirmStatus === '待重新确认' &&
    !anomaly.plan.approvedBy &&
    (!anomaly.plan.basedOnReadingId || anomaly.plan.basedOnReadingId !== latestReadingId)
  ) {
    stale.push({ source: `处置方案 ${anomaly.plan.action}`, confirmStatus: anomaly.plan.confirmStatus })
  }
  return stale
}

export const needsReconfirm = (anomaly: Anomaly, latestReadingId: string): boolean =>
  staleConclusions(anomaly, latestReadingId).length > 0

/** 重大异常存在未决冲突时禁止送审批/关闭，其余审批前置条件一并校验 */
export const approvalBlockReason = (anomaly: Anomaly, latestReadingId: string): string => {
  if (hasOpenConflict(anomaly)) return `存在${openConflicts(anomaly).length}个待核对冲突，须先核对后再送负责人审批`
  if (anomaly.severity === '重大' && !anomaly.plan.emergencyLinked) return '重大异常须先启动应急联动'
  if (needsReconfirm(anomaly, latestReadingId)) return '引用读数已变化，尚未批准的结论须重新确认后再审批'
  return ''
}

export const closeBlockReason = (anomaly: Anomaly, latestReadingId: string): string => {
  if (hasOpenConflict(anomaly)) return '存在待核对冲突，未决前不能关闭'
  if (!anomaly.plan.approvedBy) return '处置方案尚未经负责人审批'
  if (!anomaly.fieldReviews.length) return '缺少现场复核记录'
  if (anomaly.severity === '重大' && !anomaly.plan.emergencyLinked) return '重大异常须保留应急联动记录'
  if (needsReconfirm(anomaly, latestReadingId)) return '引用读数已变化，结论须重新确认后才能关闭'
  return ''
}

export interface AppliedItemResult {
  /** 幂等命中：该复核项此前已写入，本次不产生任何新记录 */
  duplicate: boolean
  mergedFieldCount: number
  conflictedFieldCount: number
  wasStale: boolean
}

/**
 * 把一张离线复核单（或在线复核提交）按字段合并进异常：
 * - 首次到达的字段直接采纳；同班组同内容重复上传只命中幂等，不增加审计；
 * - 与先到字段不同的改法生成“待核对”冲突，不覆盖当前值。
 */
export const applyReviewInput = (
  dataset: TailingsDataset,
  input: ReviewInput,
  makeAudit: (entry: Omit<AuditEntry, 'id' | 'createdAt'>) => AuditEntry,
  makeId: (prefix: string) => string
): AppliedItemResult => {
  const anomaly = dataset.anomalies.find((item) => item.id === input.anomalyId)
  const result: AppliedItemResult = { duplicate: true, mergedFieldCount: 0, conflictedFieldCount: 0, wasStale: false }
  if (!anomaly) return result

  if (dataset.audit.some((entry) => entry.idempotencyKey === input.itemId)) return result
  result.duplicate = false

  const latest = latestReadingFor(dataset.readings, anomaly.pointId)
  const staleOnArrival = !!latest && input.basedOnReadingId !== latest.id
  if (staleOnArrival) result.wasStale = true

  anomaly.mergedFields ??= {}
  let touched = false

  for (const field of reviewFields) {
    const incoming = input[field].trim()
    if (!incoming) continue
    const current = anomaly.mergedFields[field]
    if (!current) {
      anomaly.mergedFields[field] = {
        value: incoming,
        crew: input.crew,
        batchId: input.batchId,
        basedOnReadingId: input.basedOnReadingId,
        confirmStatus: staleOnArrival ? '待重新确认' : '已确认'
      }
      result.mergedFieldCount += 1
      touched = true
      continue
    }
    if (current.value === incoming && current.crew === input.crew) {
      // 同班组重复上传同一内容：幂等，不产生冲突也不增加审计
      continue
    }
    if (current.value === incoming) continue
    const conflictKey = `${input.itemId}:${field}`
    // 幂等：该复核项该字段的冲突已记录过（无论是否已核对），重复上传不再产生冲突与审计
    if (
      dataset.audit.some((entry) => entry.idempotencyKey === conflictKey) ||
      anomaly.conflicts.some((conflict) => conflict.field === field && conflict.later.itemId === input.itemId)
    ) {
      continue
    }
    const conflict: FieldConflict = {
      id: makeId('CF'),
      field,
      anomalyId: anomaly.id,
      first: { crew: current.crew, batchId: current.batchId, itemId: '', value: current.value },
      later: { crew: input.crew, batchId: input.batchId, itemId: input.itemId, value: incoming },
      outcome: '待核对',
      resolvedBy: '',
      resolvedAt: ''
    }
    anomaly.conflicts.unshift(conflict)
    result.conflictedFieldCount += 1
    dataset.audit.unshift(
      makeAudit({
        entityId: anomaly.id,
        action: '复核冲突待核对',
        operator: input.crew,
        detail: `${reviewFieldLabels[field]}：${current.crew}“${truncate(current.value)}”与${input.crew}“${truncate(incoming)}”不一致，保留先到字段，后到改法待核对`,
        idempotencyKey: `${input.itemId}:${field}`,
        batchId: input.batchId,
        conflictResult: '待核对',
        confirmStatus: staleOnArrival ? '待重新确认' : '已确认'
      })
    )
  }

  if (touched) {
    // 至少有字段被采纳，形成一版复核记录（只记录该班组实际提交的字段）
    const review = {
      id: makeId('FR'),
      inspector: input.crew,
      arrivedAt: input.capturedOfflineAt,
      observed: input.observed.trim(),
      evidence: input.evidence.trim(),
      reassessment: input.reassessment.trim(),
      version: anomaly.fieldReviews.length + 1,
      crew: input.crew,
      batchId: input.batchId,
      basedOnReadingId: input.basedOnReadingId,
      confirmStatus: (staleOnArrival ? '待重新确认' : '已确认') as ConfirmStatus
    }
    anomaly.fieldReviews.unshift(review)
    anomaly.version += 1
    dataset.audit.unshift(
      makeAudit({
        entityId: anomaly.id,
        action: input.batchId === 'online' ? '提交现场复核' : '合并离线复核',
        operator: input.crew,
        detail:
          `合并${result.mergedFieldCount}个字段（${input.crew}）` +
          (result.conflictedFieldCount ? `；${result.conflictedFieldCount}个不同改法挂起待核对` : '') +
          (staleOnArrival ? '；引用读数已变化，结论待重新确认' : ''),
        idempotencyKey: input.itemId,
        batchId: input.batchId,
        conflictResult: result.conflictedFieldCount ? '待核对' : '保留先到',
        confirmStatus: staleOnArrival ? '待重新确认' : '已确认'
      })
    )
  } else if (result.mergedFieldCount === 0 && result.conflictedFieldCount === 0) {
    // 没有任何字段被采纳、也没有新冲突：重复上传，按幂等处理
    result.duplicate = true
  }
  return result
}

/** 处置建议字段冲突被“采用后到”时，把建议落到处置方案草案（仍需重新确认/审批） */
export const applyConflictResolution = (
  dataset: TailingsDataset,
  anomalyId: string,
  conflictId: string,
  outcome: Exclude<FieldConflict['outcome'], '待核对'>,
  operator: string,
  makeAudit: (entry: Omit<AuditEntry, 'id' | 'createdAt'>) => AuditEntry
): void => {
  const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
  const conflict = anomaly?.conflicts.find((item) => item.id === conflictId)
  if (!anomaly || !conflict || conflict.outcome !== '待核对') return

  conflict.outcome = outcome
  conflict.resolvedBy = operator
  conflict.resolvedAt = new Date().toISOString()

  if (outcome === '采用后到') {
    anomaly.mergedFields ??= {}
    const previous = anomaly.mergedFields[conflict.field]
    anomaly.mergedFields[conflict.field] = {
      value: conflict.later.value,
      crew: conflict.later.crew,
      batchId: conflict.later.batchId,
      basedOnReadingId: previous?.basedOnReadingId ?? '',
      confirmStatus: previous?.confirmStatus ?? '已确认'
    }
    if (conflict.field === 'planSuggestion') {
      anomaly.plan.conditions = conflict.later.value
      anomaly.plan.batchId = conflict.later.batchId
      anomaly.plan.crew = conflict.later.crew
      anomaly.plan.basedOnReadingId = previous?.basedOnReadingId || anomaly.plan.basedOnReadingId
      anomaly.plan.confirmStatus = previous?.confirmStatus ?? anomaly.plan.confirmStatus
      if (anomaly.status === '已关闭') {
        // 关闭后不允许改写方案，状态不变
      } else if (!anomaly.plan.approvedBy) {
        anomaly.status = '待负责人审批'
      }
    }
    anomaly.version += 1
  }

  dataset.audit.unshift(
    makeAudit({
      entityId: anomaly.id,
      action: '核对复核冲突',
      operator,
      detail:
        `${reviewFieldLabels[conflict.field]}冲突：${outcome}` +
        (outcome === '采用后到' ? `，采纳${conflict.later.crew}“${truncate(conflict.later.value)}”` : `，维持${conflict.first.crew}“${truncate(conflict.first.value)}”`),
      idempotencyKey: `resolve:${conflict.id}`,
      batchId: conflict.later.batchId,
      conflictResult: outcome
    })
  )
}

export interface ReadingChangeResult {
  newReadingId: string
  invalidated: string[]
}

/**
 * 引用读数变化：尚未批准的结论（复核版本 + 处置方案草案）立即失效，
 * 置为“待重新确认”；重大异常未决冲突/待确认期间不得审批或关闭。
 */
export const recordReadingChange = (
  dataset: TailingsDataset,
  pointId: string,
  makeReading: () => RawReading,
  makeAudit: (entry: Omit<AuditEntry, 'id' | 'createdAt'>) => AuditEntry
): ReadingChangeResult => {
  const reading = makeReading()
  dataset.readings.unshift(reading)
  const invalidated: string[] = []

  dataset.anomalies
    .filter((anomaly) => anomaly.pointId === pointId)
    .forEach((anomaly) => {
      const invalidatedHere: string[] = []
      anomaly.triggerReadingId = reading.id
      anomaly.fieldReviews.forEach((review) => {
        if (review.confirmStatus !== '待重新确认') {
          review.confirmStatus = '待重新确认'
          invalidatedHere.push(`复核 ${review.inspector} V${review.version}`)
        }
      })
      Object.values(anomaly.mergedFields ?? {}).forEach((field) => {
        if (field) field.confirmStatus = '待重新确认'
      })
      if (!anomaly.plan.approvedBy && anomaly.plan.conditions) {
        if (anomaly.plan.confirmStatus !== '待重新确认') {
          anomaly.plan.confirmStatus = '待重新确认'
          invalidatedHere.push(`处置方案 ${anomaly.plan.action}`)
        }
        if (anomaly.status === '待负责人审批' || anomaly.status === '应急联动') {
          // 结论失效退回调查，重新确认后方可再送审批
          if (!hasOpenConflict(anomaly)) anomaly.status = '原因调查中'
        }
      }
      anomaly.version += 1
      invalidated.push(...invalidatedHere)
      dataset.audit.unshift(
        makeAudit({
          entityId: anomaly.id,
          action: '引用读数变化',
          operator: '监测设备',
          detail:
            `新读数 ${reading.value}${reading.unit}（${reading.id}）写入` +
            (invalidatedHere.length ? `，${invalidatedHere.join('、')}的未批准结论失效，须重新确认` : '，当前无待失效的未批准结论'),
          idempotencyKey: `reading:${reading.id}`,
          confirmStatus: invalidatedHere.length ? '待重新确认' : '已确认'
        })
      )
    })

  return { newReadingId: reading.id, invalidated }
}

export const reconfirmAnomaly = (
  dataset: TailingsDataset,
  anomalyId: string,
  operator: string,
  makeAudit: (entry: Omit<AuditEntry, 'id' | 'createdAt'>) => AuditEntry
): void => {
  const anomaly = dataset.anomalies.find((item) => item.id === anomalyId)
  if (!anomaly) return
  const latest = latestReadingFor(dataset.readings, anomaly.pointId)
  if (!latest) return

  let count = 0
  anomaly.fieldReviews.forEach((review) => {
    if (review.confirmStatus === '待重新确认' && review.basedOnReadingId !== latest.id) {
      review.confirmStatus = '已确认'
      review.basedOnReadingId = latest.id
      count += 1
    }
  })
  Object.values(anomaly.mergedFields ?? {}).forEach((field) => {
    if (field && field.confirmStatus === '待重新确认') {
      field.confirmStatus = '已确认'
      field.basedOnReadingId = latest.id
    }
  })
  const planWasStale = anomaly.plan.confirmStatus === '待重新确认' && !anomaly.plan.approvedBy
  if (planWasStale) {
    anomaly.plan.confirmStatus = '已确认'
    anomaly.plan.basedOnReadingId = latest.id
    count += 1
  }
  if (!count) return

  anomaly.version += 1
  if (planWasStale && anomaly.status === '原因调查中' && !hasOpenConflict(anomaly)) {
    anomaly.status = '待负责人审批'
  }
  dataset.audit.unshift(
    makeAudit({
      entityId: anomaly.id,
      action: '重新确认结论',
      operator,
      detail: `基于最新读数 ${latest.id}（${latest.value}${latest.unit}）重新确认 ${count} 项结论`,
      idempotencyKey: `reconfirm:${anomaly.id}:${latest.id}`,
      confirmStatus: '已确认'
    })
  )
}

export const itemToInput = (batchId: string, item: OfflineReviewItem): ReviewInput => ({
  itemId: item.idempotencyKey,
  anomalyId: item.anomalyId,
  crew: item.crew,
  batchId,
  observed: item.observed,
  evidence: item.evidence,
  reassessment: item.reassessment,
  planSuggestion: item.planSuggestion,
  basedOnReadingId: item.basedOnReadingId,
  capturedOfflineAt: item.capturedOfflineAt
})

const truncate = (value: string): string => (value.length > 24 ? `${value.slice(0, 24)}…` : value)
