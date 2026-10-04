import { createFeatureSelector, createSelector } from '@ngrx/store'
import {
  approvalBlockReason,
  closeBlockReason,
  hasOpenConflict,
  latestReadingFor,
  needsReconfirm
} from '../domain/rules'
import type { TailingsState } from './tailings.reducer'

export const selectTailings = createFeatureSelector<TailingsState>('tailings')
export const selectDataset = createSelector(selectTailings, (state) => state.dataset)
export const selectPoints = createSelector(selectDataset, (dataset) => dataset.points)
export const selectReadings = createSelector(selectDataset, (dataset) => dataset.readings)
export const selectAnomalies = createSelector(selectDataset, (dataset) => dataset.anomalies)
export const selectSyncBatches = createSelector(selectDataset, (dataset) => dataset.syncBatches)
export const selectNotice = createSelector(selectTailings, (state) => state.notice)
export const selectSelectedAnomaly = createSelector(selectTailings, (state) => state.dataset.anomalies.find((item) => item.id === state.selectedAnomalyId) ?? state.dataset.anomalies[0])

export const selectSelectedAnomalyContext = createSelector(selectDataset, selectSelectedAnomaly, (dataset, anomaly) => {
  if (!anomaly) return undefined
  const point = dataset.points.find((item) => item.id === anomaly.pointId)
  const latestReading = latestReadingFor(dataset.readings, anomaly.pointId)
  return {
    anomaly,
    point,
    latestReading,
    openConflictCount: anomaly.conflicts.filter((conflict) => conflict.outcome === '待核对').length,
    hasOpenConflict: hasOpenConflict(anomaly),
    needsReconfirm: latestReading ? needsReconfirm(anomaly, latestReading.id) : false,
    approvalBlocked: latestReading ? approvalBlockReason(anomaly, latestReading.id) : '',
    closeBlocked: latestReading ? closeBlockReason(anomaly, latestReading.id) : ''
  }
})

export const selectFilteredAnomalies = createSelector(selectTailings, (state) => state.dataset.anomalies.filter((item) => {
  const point = state.dataset.points.find((value) => value.id === item.pointId)
  const text = `${item.id} ${item.title} ${item.owner} ${point?.name ?? ''}`.toLowerCase()
  return (!state.keyword || text.includes(state.keyword.toLowerCase())) && (state.status === '全部' || item.status === state.status)
}))
