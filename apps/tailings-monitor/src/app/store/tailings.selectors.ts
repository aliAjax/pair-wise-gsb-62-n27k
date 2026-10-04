import { createFeatureSelector, createSelector } from '@ngrx/store'
import type { TailingsState } from './tailings.reducer'

export const selectTailings = createFeatureSelector<TailingsState>('tailings')
export const selectDataset = createSelector(selectTailings, (state) => state.dataset)
export const selectPoints = createSelector(selectDataset, (dataset) => dataset.points)
export const selectAnomalies = createSelector(selectDataset, (dataset) => dataset.anomalies)
export const selectSyncBatches = createSelector(selectDataset, (dataset) => dataset.syncBatches)
export const selectSelectedAnomaly = createSelector(selectTailings, (state) => state.dataset.anomalies.find((item) => item.id === state.selectedAnomalyId) ?? state.dataset.anomalies[0])
export const selectFilteredAnomalies = createSelector(selectTailings, (state) => state.dataset.anomalies.filter((item) => {
  const point = state.dataset.points.find((value) => value.id === item.pointId)
  const text = `${item.id} ${item.title} ${item.owner} ${point?.name ?? ''}`.toLowerCase()
  return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
}))
export const selectOpenConflicts = createSelector(selectAnomalies, (anomalies) => anomalies.flatMap((anomaly) => anomaly.pendingConflicts.filter((item) => item.status === '待核对')))
export const selectStaleReviews = createSelector(selectAnomalies, (anomalies) => anomalies.flatMap((anomaly) => anomaly.fieldReviews.filter((item) => item.confirmStatus === '待重新确认').map((review) => ({ anomalyId: anomaly.id, review }))))
