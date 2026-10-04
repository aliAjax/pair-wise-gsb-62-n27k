import { CommonModule } from '@angular/common'
import { Component, OnInit, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { Store } from '@ngrx/store'
import type { Crew, OfflineReviewItem, SyncBatch } from '../domain'
import { latestReadingFor } from '../domain/rules'
import { TailingsActions } from '../store/tailings.actions'
import { selectAnomalies, selectDataset, selectSyncBatches } from '../store/tailings.selectors'

interface StagedItem {
  anomalyId: string
  crew: Crew
  observed: string
  evidence: string
  reassessment: string
  planSuggestion: string
}

@Component({
  selector: 'app-offline-sync',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule],
  template: `
    <section class="sync-panel">
      <div class="head">
        <div><h3>离线复核单与断点恢复</h3><p>坝区断网时按复核单登记；回连后同步只补未写完的复核项，重复上传不增加审计。</p></div>
        <span class="batch-count">{{ (batches$ | async)?.length || 0 }} 个批次</span>
      </div>

      <div class="composer">
        <div class="composer-row">
          <mat-form-field appearance="outline"><mat-label>异常</mat-label>
            <mat-select [(ngModel)]="draft.anomalyId"><mat-option *ngFor="let item of anomalies$ | async" [value]="item.id">{{ item.id }} · {{ item.title }}</mat-option></mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline"><mat-label>班组</mat-label>
            <mat-select [(ngModel)]="draft.crew"><mat-option value="甲班">甲班</mat-option><mat-option value="乙班">乙班</mat-option></mat-select>
          </mat-form-field>
          <button mat-stroked-button (click)="stageItem()">加入本批复核单</button>
          <button mat-flat-button color="primary" [disabled]="!staged.length" (click)="queueBatch()">登记离线批次（{{ staged.length }}项）</button>
        </div>
        <div class="composer-row">
          <mat-form-field appearance="outline" class="grow"><mat-label>现场观察</mat-label><input matInput [(ngModel)]="draft.observed" placeholder="断网现场记录的观察" /></mat-form-field>
          <mat-form-field appearance="outline" class="grow"><mat-label>证据清单</mat-label><input matInput [(ngModel)]="draft.evidence" /></mat-form-field>
        </div>
        <div class="composer-row">
          <mat-form-field appearance="outline" class="grow"><mat-label>重新评估</mat-label><input matInput [(ngModel)]="draft.reassessment" /></mat-form-field>
          <mat-form-field appearance="outline" class="grow"><mat-label>处置建议</mat-label><input matInput [(ngModel)]="draft.planSuggestion" /></mat-form-field>
        </div>
        <div class="staged" *ngIf="staged.length">
          <b>本批复核单（断网暂存）</b>
          <article *ngFor="let item of staged; let i = index">
            <span class="tag">{{ item.crew }}</span>
            <span>{{ item.anomalyId }} · 观察{{ item.observed ? '✓' : '—' }} 证据{{ item.evidence ? '✓' : '—' }} 评估{{ item.reassessment ? '✓' : '—' }} 建议{{ item.planSuggestion ? '✓' : '—' }}</span>
            <button mat-button color="warn" (click)="staged.splice(i, 1)">移除</button>
          </article>
          <small>两个班组对同一异常的不同改法：先到字段直接合并，后到改法挂起“待核对”。</small>
        </div>
      </div>

      <div class="batches">
        <article class="batch" *ngFor="let batch of batches$ | async">
          <div class="batch-head">
            <div><b>批次 {{ batch.id }}</b><small>登记 {{ batch.submittedAt.replace('T', ' ').slice(0, 16) }}<ng-container *ngIf="batch.syncedAt"> · 完成 {{ batch.syncedAt.replace('T', ' ').slice(0, 16) }}</ng-container></small></div>
            <span class="status" [class.done]="batch.status === '已完成'" [class.fail]="batch.status === '部分失败'" [class.run]="batch.status === '同步中' || batch.status === '待同步'">{{ batch.status }}</span>
          </div>
          <ul class="items">
            <li *ngFor="let item of batch.items">
              <span class="dot" [class.ok]="item.status === '写入成功'" [class.bad]="item.status === '写入失败'" [class.wait]="item.status === '待同步'"></span>
              <span class="tag">{{ item.crew }}</span>
              <span>{{ item.anomalyId }}</span>
              <small>引用读数 {{ item.basedOnReadingId }}</small>
              <i [class.ok]="item.status === '写入成功'" [class.bad]="item.status === '写入失败'">{{ item.status }}</i>
            </li>
          </ul>
          <div class="batch-actions">
            <button mat-flat-button color="primary" (click)="sync(batch)">{{ batch.status === '部分失败' ? '从断点恢复（只补未写项）' : '同步批次' }}</button>
            <button mat-stroked-button [disabled]="batch.status === '已完成'" (click)="armFailure(batch)">{{ batch.failNextWrite ? '下一条将写入失败 ✓' : '模拟下一条写入失败' }}</button>
            <small *ngIf="batch.status === '已完成'">再次同步不会重写，也不增加审计记录（幂等）。</small>
          </div>
        </article>
      </div>
    </section>
  `,
  styles: [`
    .sync-panel { background: white; border: 1px solid #d9e1df; padding: 14px 16px; margin-bottom: 14px; }
    .head { display: flex; justify-content: space-between; align-items: start; border-bottom: 1px solid #eef1f0; padding-bottom: 10px; margin-bottom: 10px; }
    .head h3 { margin: 0 0 4px; font-size: 14px; } .head p { margin: 0; color: #72807d; font-size: 11px; }
    .batch-count { color: #315d6e; font-size: 11px; }
    .composer { background: #f6f9f8; border: 1px dashed #c7d6d2; padding: 10px; margin-bottom: 12px; }
    .composer-row { display: flex; gap: 8px; align-items: center; } .composer-row .grow { flex: 1; }
    .composer mat-form-field { width: 190px; } .composer-row .grow mat-form-field { width: 100%; }
    .staged { margin-top: 6px; display: grid; gap: 5px; } .staged b { font-size: 11px; color: #315d6e; }
    .staged article { display: flex; align-items: center; gap: 8px; background: white; border: 1px solid #e2e7e6; padding: 4px 8px; }
    .staged span { font-size: 11px; color: #48544f; } .staged small { color: #8a9693; font-size: 10px; }
    .tag { background: #e4eeec; color: #245060; border-radius: 3px; padding: 2px 7px; font-size: 10px; font-style: normal; }
    .batches { display: grid; gap: 10px; }
    .batch { border: 1px solid #e2e7e6; padding: 10px 12px; }
    .batch-head { display: flex; justify-content: space-between; align-items: center; }
    .batch-head b { font-size: 12px; } .batch-head small { display: block; color: #8a9693; font-size: 10px; margin-top: 2px; }
    .status { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: #eef1f0; color: #5b6864; }
    .status.done { background: #e7f3ee; color: #2e765a; } .status.fail { background: #fae8e6; color: #a43c35; } .status.run { background: #e8f0f4; color: #2f6180; }
    .items { list-style: none; padding: 0; margin: 8px 0; display: grid; gap: 5px; }
    .items li { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #48544f; }
    .items small { color: #8a9693; } .items i { font-style: normal; font-size: 10px; margin-left: auto; }
    .items i.ok { color: #2e765a; } .items i.bad { color: #a43c35; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #c3ccca; } .dot.ok { background: #3e8a6b; } .dot.bad { background: #b84038; } .dot.wait { background: #c28d27; }
    .batch-actions { display: flex; align-items: center; gap: 8px; } .batch-actions small { color: #8a9693; font-size: 10px; }
  `]
})
export class OfflineSyncComponent implements OnInit {
  private readonly store = inject(Store)
  readonly batches$ = this.store.select(selectSyncBatches)
  readonly anomalies$ = this.store.select(selectAnomalies)
  private readonly dataset$ = this.store.select(selectDataset)

  staged: StagedItem[] = []
  draft: StagedItem = { anomalyId: '', crew: '甲班', observed: '', evidence: '', reassessment: '', planSuggestion: '' }

  ngOnInit(): void {
    this.anomalies$.subscribe((anomalies) => {
      if (!this.draft.anomalyId && anomalies.length) this.draft.anomalyId = anomalies[0].id
    }).unsubscribe()
  }

  stageItem(): void {
    if (!this.draft.anomalyId) return
    this.staged.push({ ...this.draft })
    this.draft = { anomalyId: this.draft.anomalyId, crew: this.draft.crew === '甲班' ? '乙班' : '甲班', observed: '', evidence: '', reassessment: '', planSuggestion: '' }
  }

  queueBatch(): void {
    // 取当前快照：确定每个复核项所属测点与引用的最新读数
    let dataset: import('../domain').TailingsDataset | undefined
    this.dataset$.subscribe((value) => { dataset = value }).unsubscribe()
    if (!dataset) return

    const now = new Date()
    const batchId = `B-${now.toISOString().slice(0, 10).replace(/-/g, '')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
    const items: OfflineReviewItem[] = this.staged.map((item, index) => {
      const anomaly = dataset!.anomalies.find((candidate) => candidate.id === item.anomalyId)
      const pointId = anomaly?.pointId ?? ''
      return {
        id: `OI-${batchId}-${index + 1}`,
        anomalyId: item.anomalyId,
        crew: item.crew,
        observed: item.observed,
        evidence: item.evidence,
        reassessment: item.reassessment,
        planSuggestion: item.planSuggestion,
        basedOnReadingId: latestReadingFor(dataset!.readings, pointId)?.id ?? anomaly?.triggerReadingId ?? '',
        capturedOfflineAt: new Date().toISOString(),
        status: '待同步',
        idempotencyKey: `item-${batchId}-${index + 1}`
      }
    })
    const batch: SyncBatch = {
      id: batchId,
      submittedAt: new Date().toISOString(),
      syncedAt: '',
      status: '待同步',
      failNextWrite: false,
      items
    }
    this.store.dispatch(TailingsActions.queueOfflineBatch({ batch }))
    this.staged = []
  }

  sync(batch: SyncBatch): void {
    this.store.dispatch(TailingsActions.syncBatch({ batchId: batch.id }))
  }

  armFailure(batch: SyncBatch): void {
    this.store.dispatch(TailingsActions.armWriteFailure({ batchId: batch.id }))
  }
}
