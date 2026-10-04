import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import { map } from 'rxjs'
import { TailingsActions } from '../store/tailings.actions'
import { selectDataset } from '../store/tailings.selectors'

@Component({
  selector: 'app-monitoring-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule],
  template: `
    <section class="page">
      <div class="page-head"><div><h2>测点与原始读数</h2><p>原始读数只读展示，现场复核和修正以独立版本保存。</p></div><mat-form-field appearance="outline"><mat-label>搜索测点</mat-label><input matInput [(ngModel)]="keyword" /></mat-form-field></div>
      <div class="split">
        <table mat-table [dataSource]="filteredPoints$ | async" class="panel">
          <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>测点</th><td mat-cell *matCellDef="let row">{{ row.name }}</td></ng-container>
          <ng-container matColumnDef="zone"><th mat-header-cell *matHeaderCellDef>分区</th><td mat-cell *matCellDef="let row">{{ row.zone }}</td></ng-container>
          <ng-container matColumnDef="type"><th mat-header-cell *matHeaderCellDef>类型</th><td mat-cell *matCellDef="let row">{{ row.type }}</td></ng-container>
          <ng-container matColumnDef="value"><th mat-header-cell *matHeaderCellDef>当前值</th><td mat-cell *matCellDef="let row"><b>{{ row.currentValue }} {{ row.unit }}</b></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row"><span class="status" [class.danger]="row.status === '异常'" [class.warning]="row.status === '预警'">{{ row.status }}</span></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="pointColumns"></tr><tr mat-row *matRowDef="let row; columns: pointColumns"></tr>
        </table>
        <div class="panel readings">
          <h3>最近原始读数</h3>
          <article *ngFor="let reading of (dataset$ | async)?.readings">
            <div><b>{{ reading.pointId }}</b><span>{{ reading.quality }}<em *ngIf="reading.supersedesId"> · 订正自{{ reading.supersedesId }}</em></span></div>
            <strong>{{ reading.value }} {{ reading.unit }}</strong>
            <small>{{ reading.capturedAt.replace('T', ' ').slice(0, 16) }} · 设备{{ reading.deviceId }} · {{ reading.id }}</small>
          </article>
          <p>设备读数写入后不可修改；人工复核只形成新的评估版本。</p>
          <h3>读数订正</h3>
          <p class="hint">订正生成新读数并保留原读数；引用该读数的异常若结论尚未批准，将失效并转入待重新确认。</p>
          <div class="revise-form">
            <mat-form-field appearance="outline" class="wide"><mat-label>被订正读数</mat-label><mat-select [(ngModel)]="reviseForm.readingId"><mat-option *ngFor="let reading of (dataset$ | async)?.readings" [value]="reading.id">{{ reading.id }} · {{ reading.pointId }} · {{ reading.value }} {{ reading.unit }}</mat-option></mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>订正值</mat-label><input matInput type="number" [(ngModel)]="reviseForm.value" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>订正原因</mat-label><input matInput [(ngModel)]="reviseForm.reason" /></mat-form-field>
            <button mat-flat-button color="primary" [disabled]="!canRevise" (click)="revise()">提交订正</button>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }.page-head h2 { margin: 0 0 5px; font-size: 20px; }.page-head p { margin: 0; color: #72807d; font-size: 12px; }
    .split { display: grid; grid-template-columns: 1fr 330px; gap: 14px; align-items: start; }.panel { background: white; border: 1px solid #d9e1df; } table { width: 100%; }
    .readings { padding: 15px; } .readings h3 { font-size: 14px; margin: 0 0 12px; } .readings article { border-bottom: 1px solid #e2e7e6; padding: 10px 0; display: grid; gap: 4px; }.readings article div { display: flex; justify-content: space-between; color: #667572; font-size: 11px; }.readings article em { font-style: normal; color: #a5521f; }.readings small, .readings p { color: #7a8784; font-size: 10px; }.status { padding: 3px 7px; background: #e7f3ee; color: #2e765a; border-radius: 3px; font-size: 11px; }.status.warning { background: #f8efd9; color: #936d20; }.status.danger { background: #fae8e6; color: #a43c35; }
    .hint { background: #f6f0df; border-left: 3px solid #c99f3d; padding: 8px 10px; }.revise-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }.revise-form .wide { grid-column: 1 / -1; }.revise-form button { grid-column: 1 / -1; }
  `]
})
export class MonitoringPageComponent {
  private readonly store = inject(Store)
  keyword = ''
  readonly pointColumns = ['name', 'zone', 'type', 'value', 'status']
  readonly dataset$ = this.store.select(selectDataset)
  readonly filteredPoints$ = this.dataset$.pipe(map((dataset) => dataset.points.filter((point) => !this.keyword || `${point.name} ${point.zone} ${point.type} ${point.id}`.includes(this.keyword))))
  reviseForm: { readingId: string; value: number | null; reason: string } = { readingId: '', value: null, reason: 'GNSS基准站时钟漂移修正' }
  get canRevise(): boolean { return !!this.reviseForm.readingId && String(this.reviseForm.value ?? '').trim() !== '' && Number.isFinite(Number(this.reviseForm.value)) }
  revise(): void {
    if (!this.canRevise) return
    this.store.dispatch(TailingsActions.reviseReading({ readingId: this.reviseForm.readingId, value: Number(this.reviseForm.value), reason: this.reviseForm.reason }))
    this.reviseForm = { ...this.reviseForm, readingId: '', value: null }
  }
}
