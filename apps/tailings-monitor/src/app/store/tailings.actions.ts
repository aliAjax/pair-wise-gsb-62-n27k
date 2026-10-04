import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type {
  AuditEntry,
  Crew,
  DispositionPlan,
  ExpertOpinion,
  FieldConflict,
  FieldReview,
  RawReading,
  SyncBatch,
  TailingsDataset
} from '../domain'

export const TailingsActions = createActionGroup({
  source: 'Tailings',
  events: {
    'Load Dataset': emptyProps(),
    'Load Dataset Success': props<{ dataset: TailingsDataset }>(),
    'Load Dataset Failure': props<{ error: string }>(),

    /** 现场复核（在线提交，走与离线批次相同的按字段合并规则） */
    'Submit Field Review': props<{ anomalyId: string; review: FieldReview; crew: Crew; basedOnReadingId: string; planSuggestion: string }>(),
    'Add Expert Opinion': props<{ anomalyId: string; opinion: ExpertOpinion }>(),
    'Save Disposition Plan': props<{ anomalyId: string; plan: DispositionPlan }>(),

    /** 离线复核单：登记一个待同步批次（可含多个班组/多个异常的复核项） */
    'Queue Offline Batch': props<{ batch: SyncBatch }>(),
    /** 同步（或从断点恢复）；只补未写完的复核项 */
    'Sync Batch': props<{ batchId: string }>(),
    /** 模拟下一条写入失败，用于演示断点恢复 */
    'Arm Write Failure': props<{ batchId: string }>(),

    /** 核对两个班组的字段冲突：保留先到 / 采用后到 */
    'Resolve Conflict': props<{ anomalyId: string; conflictId: string; outcome: Exclude<FieldConflict['outcome'], '待核对'>; operator: string }>(),

    /** 新读数写入（引用读数变化），未批准结论失效 */
    'Register Reading': props<{ pointId: string; reading: RawReading }>(),
    /** 基于最新读数重新确认失效结论 */
    'Reconfirm Conclusions': props<{ anomalyId: string; operator: string }>(),

    'Approve Plan': props<{ anomalyId: string; approver: string; note: string }>(),
    'Close Anomaly': props<{ anomalyId: string; note: string }>(),
    'Create Emergency Link': props<{ anomalyId: string; note: string }>(),
    'Select Anomaly': props<{ anomalyId: string }>(),
    'Update Keyword': props<{ keyword: string }>(),
    'Update Status': props<{ status: string }>(),
    'Add Audit': props<{ entry: AuditEntry }>(),
    'Reset Demo': emptyProps()
  }
})
