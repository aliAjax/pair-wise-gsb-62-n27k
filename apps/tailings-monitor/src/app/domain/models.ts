export type MonitoringType = '位移' | '水位' | '渗流' | '降雨'
export type PointStatus = '正常' | '预警' | '异常'
export type AnomalyStatus = '待现场复核' | '原因调查中' | '待负责人审批' | '应急联动' | '已关闭'
export type Severity = '关注' | '较高' | '重大'
export type ConfirmStatus = '有效' | '待重新确认'
export type MergeOutcome = '已接受' | '待核对' | '重复忽略'
export type BatchStatus = '已完成' | '部分失败'

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
  supersedesId: string
}

export interface ExpertOpinion {
  id: string
  specialist: string
  discipline: '坝体' | '水文' | '岩土' | '应急'
  content: string
  conclusion: '支持结论' | '提出异议' | '补充证据'
  createdAt: string
}

export interface FieldReview {
  id: string
  inspector: string
  arrivedAt: string
  observed: string
  evidence: string
  reassessment: string
  version: number
  team: string
  batchId: string
  sourceItemId: string
  confirmStatus: ConfirmStatus
  confirmedAt: string
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
}

export interface PendingConflict {
  id: string
  itemId: string
  anomalyId: string
  batchId: string
  team: string
  inspector: string
  observed: string
  evidence: string
  reassessment: string
  recordedAt: string
  status: '待核对' | '已采纳' | '已驳回'
  resolvedBy: string
  resolvedAt: string
}

export interface OfflineReviewItem {
  id: string
  anomalyId: string
  team: string
  inspector: string
  observed: string
  evidence: string
  reassessment: string
  recordedAt: string
  baseVersion: number
}

export interface MergeReceipt {
  itemId: string
  anomalyId: string
  team: string
  outcome: MergeOutcome
  detail: string
}

export interface SyncBatch {
  id: string
  team: string
  createdAt: string
  status: BatchStatus
  failureReason: string
  appliedItemIds: string[]
  results: MergeReceipt[]
  items: OfflineReviewItem[]
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
  pendingConflicts: PendingConflict[]
  closedAt: string
  version: number
}

export interface AuditEntry {
  id: string
  entityId: string
  action: string
  operator: string
  detail: string
  createdAt: string
  batchId: string
  outcome: string
}

export interface TailingsDataset {
  points: MonitoringPoint[]
  thresholds: Threshold[]
  readings: RawReading[]
  anomalies: Anomaly[]
  audit: AuditEntry[]
  syncBatches: SyncBatch[]
}
