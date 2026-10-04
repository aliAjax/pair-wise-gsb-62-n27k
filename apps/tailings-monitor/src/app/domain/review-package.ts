import type { TailingsDataset } from './models'

export interface ReviewPackageBatch {
  batchId: string
  status: string
  submittedAt: string
  syncedAt: string
  itemResults: Array<{
    itemId: string
    anomalyId: string
    crew: string
    basedOnReadingId: string
    status: string
  }>
}

export interface ReviewPackageAnomaly {
  anomalyId: string
  title: string
  severity: string
  status: string
  version: number
  latestReading: { id: string; value: number; unit: string; capturedAt: string } | null
  mergedFields: Array<{ field: string; value: string; crew: string; batchId: string; basedOnReadingId: string; confirmStatus: string }>
  conflicts: Array<{ id: string; field: string; firstCrew: string; firstBatch: string; laterCrew: string; laterBatch: string; outcome: string; resolvedBy: string; resolvedAt: string }>
  reviews: Array<{ id: string; inspector: string; version: number; crew: string; batchId: string; basedOnReadingId: string; confirmStatus: string }>
  plan: { action: string; owner: string; crew: string; batchId: string; basedOnReadingId: string; confirmStatus: string; approvedBy: string }
}

export interface ReviewPackage {
  generatedAt: string
  summary: {
    anomalyCount: number
    openConflictCount: number
    staleConclusionCount: number
    batchCount: number
  }
  batches: ReviewPackageBatch[]
  anomalies: ReviewPackageAnomaly[]
  auditTrail: TailingsDataset['audit']
}

export const buildReviewPackage = (dataset: TailingsDataset): ReviewPackage => {
  const latestReadingOf = (pointId: string) =>
    dataset.readings
      .filter((reading) => reading.pointId === pointId)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0] ?? null

  const anomalies: ReviewPackageAnomaly[] = dataset.anomalies.map((anomaly) => {
    const latest = latestReadingOf(anomaly.pointId)
    return {
      anomalyId: anomaly.id,
      title: anomaly.title,
      severity: anomaly.severity,
      status: anomaly.status,
      version: anomaly.version,
      latestReading: latest ? { id: latest.id, value: latest.value, unit: latest.unit, capturedAt: latest.capturedAt } : null,
      mergedFields: Object.entries(anomaly.mergedFields ?? {}).map(([field, value]) => ({
        field,
        value: value?.value ?? '',
        crew: value?.crew ?? '',
        batchId: value?.batchId ?? '',
        basedOnReadingId: value?.basedOnReadingId ?? '',
        confirmStatus: value?.confirmStatus ?? ''
      })),
      conflicts: anomaly.conflicts.map((conflict) => ({
        id: conflict.id,
        field: conflict.field,
        firstCrew: conflict.first.crew,
        firstBatch: conflict.first.batchId,
        laterCrew: conflict.later.crew,
        laterBatch: conflict.later.batchId,
        outcome: conflict.outcome,
        resolvedBy: conflict.resolvedBy,
        resolvedAt: conflict.resolvedAt
      })),
      reviews: anomaly.fieldReviews.map((review) => ({
        id: review.id,
        inspector: review.inspector,
        version: review.version,
        crew: review.crew ?? '',
        batchId: review.batchId ?? '',
        basedOnReadingId: review.basedOnReadingId ?? '',
        confirmStatus: review.confirmStatus ?? '已确认'
      })),
      plan: {
        action: anomaly.plan.action,
        owner: anomaly.plan.owner,
        crew: anomaly.plan.crew ?? '',
        batchId: anomaly.plan.batchId ?? '',
        basedOnReadingId: anomaly.plan.basedOnReadingId ?? '',
        confirmStatus: anomaly.plan.confirmStatus ?? '已确认',
        approvedBy: anomaly.plan.approvedBy
      }
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      anomalyCount: dataset.anomalies.length,
      openConflictCount: dataset.anomalies.reduce((sum, anomaly) => sum + anomaly.conflicts.filter((conflict) => conflict.outcome === '待核对').length, 0),
      staleConclusionCount: dataset.anomalies.reduce(
        (sum, anomaly) =>
          sum +
          anomaly.fieldReviews.filter((review) => review.confirmStatus === '待重新确认').length +
          (anomaly.plan.confirmStatus === '待重新确认' ? 1 : 0),
        0
      ),
      batchCount: dataset.syncBatches.length
    },
    batches: dataset.syncBatches.map((batch) => ({
      batchId: batch.id,
      status: batch.status,
      submittedAt: batch.submittedAt,
      syncedAt: batch.syncedAt,
      itemResults: batch.items.map((item) => ({
        itemId: item.id,
        anomalyId: item.anomalyId,
        crew: item.crew,
        basedOnReadingId: item.basedOnReadingId,
        status: item.status
      }))
    })),
    anomalies,
    auditTrail: dataset.audit
  }
}
