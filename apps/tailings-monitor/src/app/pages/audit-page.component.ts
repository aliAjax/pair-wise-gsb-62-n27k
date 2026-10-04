import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { TailingsApiService } from '../services/tailings-api.service'
import { selectDataset, selectOpenConflicts, selectStaleReviews } from '../store/tailings.selectors'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head"><div><h2>审计与版本追溯</h2><p>异常创建、原始读数、现场复核、离线批次合并、专业意见、处置方案、审批和关闭全部留痕。</p></div><button mat-flat-button color="primary" (click)="exportPackage()">导出审阅包</button></div>
      <div class="summary">
        <article><span>离线批次</span><b>{{ (dataset$ | async)?.syncBatches?.length ?? 0 }}</b><small>含断点恢复记录</small></article>
        <article><span>未决冲突</span><b>{{ (openConflicts$ | async)?.length ?? 0 }}</b><small>重大异常未核对前禁审批</small></article>
        <article><span>待重新确认</span><b>{{ (staleReviews$ | async)?.length ?? 0 }}</b><small>引用读数变化所致</small></article>
      </div>
      <div class="toolbar"><mat-form-field appearance="outline"><mat-label>搜索实体、动作、操作人、批次</mat-label><input matInput [(ngModel)]="keyword" /></mat-form-field><span>共{{ (filtered$ | async)?.length }}条事件</span></div>
      <table mat-table [dataSource]="filtered$ | async" class="panel">
        <ng-container matColumnDef="time"><th mat-header-cell *matHeaderCellDef>时间</th><td mat-cell *matCellDef="let row">{{ row.createdAt.replace('T', ' ').slice(0, 16) }}</td></ng-container>
        <ng-container matColumnDef="entity"><th mat-header-cell *matHeaderCellDef>实体</th><td mat-cell *matCellDef="let row">{{ row.entityId }}</td></ng-container>
        <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>动作</th><td mat-cell *matCellDef="let row">{{ row.action }}</td></ng-container>
        <ng-container matColumnDef="operator"><th mat-header-cell *matHeaderCellDef>操作人</th><td mat-cell *matCellDef="let row">{{ row.operator }}</td></ng-container>
        <ng-container matColumnDef="batch"><th mat-header-cell *matHeaderCellDef>批次来源</th><td mat-cell *matCellDef="let row"><span [class.batch-tag]="!!row.batchId">{{ row.batchId || '—' }}</span></td></ng-container>
        <ng-container matColumnDef="outcome"><th mat-header-cell *matHeaderCellDef>合并结果</th><td mat-cell *matCellDef="let row"><span class="outcome" [class.ok]="row.outcome === '已接受' || row.outcome === '已采纳'" [class.warn]="row.outcome === '待核对' || row.outcome === '部分失败' || row.outcome === '待重新确认'">{{ row.outcome || '—' }}</span></td></ng-container>
        <ng-container matColumnDef="detail"><th mat-header-cell *matHeaderCellDef>说明</th><td mat-cell *matCellDef="let row">{{ row.detail }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }.head h2 { margin: 0 0 5px; font-size: 20px; }.head p { margin: 0; color: #72807d; font-size: 12px; }.toolbar { display: flex; align-items: center; gap: 12px; }.toolbar span { color: #74827f; font-size: 11px; }.panel { width: 100%; background: white; border: 1px solid #d9e1df; }
    .summary { display: grid; grid-template-columns: repeat(3, 1fr); background: white; border: 1px solid #d9e1df; margin-bottom: 14px; }.summary article { padding: 13px 16px; border-right: 1px solid #e2e7e6; }.summary article:last-child { border: 0; }.summary span, .summary b, .summary small { display: block; }.summary span { color: #72807d; font-size: 11px; }.summary b { font-size: 21px; color: #245060; margin: 4px 0; }.summary small { color: #98a4a0; font-size: 10px; }
    .batch-tag { background: #e8eef4; color: #31506e; padding: 2px 6px; border-radius: 3px; font-size: 10px; }.outcome { color: #7c8986; font-size: 11px; }.outcome.ok { color: #2e765a; }.outcome.warn { color: #a5521f; }
  `]
})
export class AuditPageComponent {
  private readonly store = inject(Store)
  private readonly api = inject(TailingsApiService)
  keyword = ''
  readonly columns = ['time', 'entity', 'action', 'operator', 'batch', 'outcome', 'detail']
  readonly dataset$ = this.store.select(selectDataset)
  readonly openConflicts$ = this.store.select(selectOpenConflicts)
  readonly staleReviews$ = this.store.select(selectStaleReviews)
  readonly filtered$ = this.dataset$.pipe(map((dataset) => dataset.audit.filter((item) => !this.keyword || `${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.batchId}`.includes(this.keyword))))
  exportPackage(): void {
    this.dataset$.subscribe((dataset) => {
      const reviewPackage = {
        meta: {
          exportedAt: new Date().toISOString(),
          batches: dataset.syncBatches.map((batch) => ({ id: batch.id, team: batch.team, status: batch.status, applied: batch.appliedItemIds.length, total: batch.items.length, results: batch.results })),
          openConflicts: dataset.anomalies.flatMap((anomaly) => anomaly.pendingConflicts.filter((item) => item.status === '待核对')),
          pendingReconfirmation: dataset.anomalies.flatMap((anomaly) => anomaly.fieldReviews.filter((item) => item.confirmStatus === '待重新确认').map((review) => ({ anomalyId: anomaly.id, reviewId: review.id, batchId: review.batchId, team: review.team })))
        },
        dataset
      }
      this.api.exportPackage(reviewPackage).subscribe((blob) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = '尾矿库监测审阅包.json'; anchor.click(); URL.revokeObjectURL(url)
      })
    }).unsubscribe()
  }
}
