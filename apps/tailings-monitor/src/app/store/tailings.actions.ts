import { createActionGroup, emptyProps, props } from '@ngrx/store'
import type { AuditEntry, DispositionPlan, ExpertOpinion, FieldReview, SyncBatch, TailingsDataset } from '../domain'

export const TailingsActions = createActionGroup({
  source: 'Tailings',
  events: {
    'Load Dataset': emptyProps(),
    'Load Dataset Success': props<{ dataset: TailingsDataset }>(),
    'Load Dataset Failure': props<{ error: string }>(),
    'Submit Field Review': props<{ anomalyId: string; review: FieldReview }>(),
    'Add Expert Opinion': props<{ anomalyId: string; opinion: ExpertOpinion }>(),
    'Save Disposition Plan': props<{ anomalyId: string; plan: DispositionPlan }>(),
    'Approve Plan': props<{ anomalyId: string; approver: string; note: string }>(),
    'Close Anomaly': props<{ anomalyId: string; note: string }>(),
    'Create Emergency Link': props<{ anomalyId: string; note: string }>(),
    'Upload Offline Batch': props<{ batch: SyncBatch; failAfter: number }>(),
    'Resume Offline Batch': props<{ batchId: string }>(),
    'Resolve Conflict': props<{ anomalyId: string; conflictId: string; decision: '已采纳' | '已驳回'; operator: string }>(),
    'Revise Reading': props<{ readingId: string; value: number; reason: string }>(),
    'Reconfirm Review': props<{ anomalyId: string; reviewId: string; operator: string }>(),
    'Select Anomaly': props<{ anomalyId: string }>(),
    'Update Keyword': props<{ keyword: string }>(),
    'Update Status': props<{ status: string }>(),
    'Add Audit': props<{ entry: AuditEntry }>(),
    'Reset Demo': emptyProps()
  }
})
