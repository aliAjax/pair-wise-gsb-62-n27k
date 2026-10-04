export type MonitoringType = '位移' | '水位' | '渗流' | '降雨'
export type PointStatus = '正常' | '预警' | '异常'
export type AnomalyStatus = '待现场复核' | '原因调查中' | '待负责人审批' | '应急联动' | '已关闭'
export type Severity = '关注' | '较高' | '重大'
export type Crew = '甲班' | '乙班'
export type ConfirmStatus = '已确认' | '待重新确认'
export type ReviewFieldKey = 'observed' | 'evidence' | 'reassessment' | 'planSuggestion'
export type ConflictOutcome = '待核对' | '保留先到' | '采用后到'
export type SyncItemStatus = '待同步' | '写入成功' | '写入失败'
export type SyncBatchStatus = '待同步' | '同步中' | '部分失败' | '已完成'

export const reviewFieldLabels: Record<ReviewFieldKey, string> = {
  observed: '现场观察',
  evidence: '证据清单',
  reassessment: '重新评估',
  planSuggestion: '处置建议'
}

export interface MonitoringPoint {
  id: string
  name: string
  zone: string
  type: MonitoringType
  longitude: number
  latitude: number
  status: PointStatus
  currentValue: number
  unit: string
  thresholdId: string
  lastInspectionAt: string
}

export interface Threshold {
  id: string
  type: MonitoringType
  warning: number
  alarm: number
  changeRate: number
  unit: string
  enabled: boolean
  version: number
}

export interface RawReading {
  id: string
  pointId: string
  value: number
  unit: string
  capturedAt: string
  deviceId: string
  quality: '有效' | '可疑' | '无效'
}

export interface ExpertOpinion {
  id: string
  specialist: string
  discipline: '坝体' | '水文' | '岩土' | '应急'
  content: string
  conclusion: '支持结论' | '提出异议' | '补充证据'
  createdAt: string
}

/** 复核记录的合并字段：内容 + 来源班组/批次 + 基于的引用读数 + 重新确认状态 */
export interface MergedField {
  value: string
  crew: Crew
  batchId: string
  basedOnReadingId: string
  confirmStatus: ConfirmStatus
}

export interface FieldReview {
  id: string
  inspector: string
  arrivedAt: string
  observed: string
  evidence: string
  reassessment: string
  version: number
  crew?: Crew
  batchId?: string
  basedOnReadingId?: string
  confirmStatus?: ConfirmStatus
}

export interface DispositionPlan {
  id: string
  action: '加密监测' | '降低库水位' | '疏通排水' | '应急撤离准备' | '工程加固'
  owner: string
  deadline: string
  conditions: string
  emergencyLinked: boolean
  approvedBy: string
  approvedAt: string
  batchId?: string
  crew?: Crew
  basedOnReadingId?: string
  confirmStatus?: ConfirmStatus
}

/** 两个班组对同一字段的不同改法：先到自动合并，后到挂起待核对 */
export interface FieldConflict {
  id: string
  field: ReviewFieldKey
  anomalyId: string
  first: { crew: Crew; batchId: string; itemId: string; value: string }
  later: { crew: Crew; batchId: string; itemId: string; value: string }
  outcome: ConflictOutcome
  resolvedBy: string
  resolvedAt: string
}

export interface Anomaly {
  id: string
  pointId: string
  title: string
  severity: Severity
  status: AnomalyStatus
  openedAt: string
  owner: string
  triggerReadingId: string
  observedValue: string
  fieldReviews: FieldReview[]
  opinions: ExpertOpinion[]
  plan: DispositionPlan
  closedAt: string
  version: number
  mergedFields?: Partial<Record<ReviewFieldKey, MergedField>>
  conflicts: FieldConflict[]
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  /** 幂等键：同一复核项重复上传不重复记审计 */
  idempotencyKey?: string
  batchId?: string
  conflictResult?: ConflictOutcome
  confirmStatus?: ConfirmStatus
}

/** 离线复核单中的一个复核项 */
export interface OfflineReviewItem {
  id: string
  anomalyId: string
  crew: Crew
  observed: string
  evidence: string
  reassessment: string
  planSuggestion: string
  basedOnReadingId: string
  capturedOfflineAt: string
  status: SyncItemStatus
  idempotencyKey: string
}

/** 回连后提交的离线批次，支持断点恢复 */
export interface SyncBatch {
  id: string
  submittedAt: string
  syncedAt: string
  status: SyncBatchStatus
  failNextWrite: boolean
  items: OfflineReviewItem[]
}

export interface TailingsDataset {
  points: MonitoringPoint[]
  thresholds: Threshold[]
  readings: RawReading[]
  anomalies: Anomaly[]
  audit: AuditEntry[]
  syncBatches: SyncBatch[]
}
