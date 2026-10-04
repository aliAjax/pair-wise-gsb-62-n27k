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
import { selectDataset } from '../store/tailings.selectors'

@Component({
  selector: 'app-audit-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatTableModule],
  template: `
    <section class="page">
      <div class="head"><div><h2>审计与版本追溯</h2><p>异常创建、原始读数、离线批次合并、冲突核对、重新确认、审批和关闭全部留痕；重复上传不增加审计记录。</p></div><button mat-flat-button color="primary" (click)="exportPackage()">导出审阅包</button></div>

      <div class="batches panel">
        <h3>批次同步与断点恢复</h3>
        <table mat-table [dataSource]="(dataset$ | async)?.syncBatches ?? []">
          <ng-container matColumnDef="id"><th mat-header-cell *matHeaderCellDef>批次</th><td mat-cell *matCellDef="let row"><b>{{ row.id }}</b></td></ng-container>
          <ng-container matColumnDef="time"><th mat-header-cell *matHeaderCellDef>登记/完成</th><td mat-cell *matCellDef="let row"><small>{{ row.submittedAt.replace('T', ' ').slice(0, 16) }} → {{ row.syncedAt ? row.syncedAt.replace('T', ' ').slice(0, 16) : '未完成' }}</small></td></ng-container>
          <ng-container matColumnDef="items"><th mat-header-cell *matHeaderCellDef>复核项</th><td mat-cell *matCellDef="let row">{{ done(row.items.length, row) }}/{{ row.items.length }} 已写入</td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>批次状态</th><td mat-cell *matCellDef="let row"><span class="status" [class.done]="row.status === '已完成'" [class.fail]="row.status === '部分失败'">{{ row.status }}</span></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="batchColumns"></tr><tr mat-row *matRowDef="let row; columns: batchColumns"></tr>
        </table>
      </div>

      <div class="toolbar"><mat-form-field appearance="outline"><mat-label>搜索实体、动作、操作人、批次</mat-label><input matInput [(ngModel)]="keyword" /></mat-form-field><span>共{{ (filtered$ | async)?.length }}条事件</span></div>
      <table mat-table [dataSource]="filtered$ | async" class="panel">
        <ng-container matColumnDef="time"><th mat-header-cell *matHeaderCellDef>时间</th><td mat-cell *matCellDef="let row">{{ row.createdAt.replace('T', ' ').slice(0, 16) }}</td></ng-container>
        <ng-container matColumnDef="entity"><th mat-header-cell *matHeaderCellDef>实体</th><td mat-cell *matCellDef="let row">{{ row.entityId }}</td></ng-container>
        <ng-container matColumnDef="batch"><th mat-header-cell *matHeaderCellDef>批次来源</th><td mat-cell *matCellDef="let row"><span class="batch" *ngIf="row.batchId">{{ row.batchId }}</span><small *ngIf="!row.batchId">—</small></td></ng-container>
        <ng-container matColumnDef="action"><th mat-header-cell *matHeaderCellDef>动作</th><td mat-cell *matCellDef="let row">{{ row.action }}</td></ng-container>
        <ng-container matColumnDef="operator"><th mat-header-cell *matHeaderCellDef>操作人</th><td mat-cell *matCellDef="let row">{{ row.operator }}</td></ng-container>
        <ng-container matColumnDef="conflict"><th mat-header-cell *matHeaderCellDef>冲突结果</th><td mat-cell *matCellDef="let row"><span class="chip" [class.pending]="row.conflictResult === '待核对'" [class.keep]="row.conflictResult === '保留先到'" [class.take]="row.conflictResult === '采用后到'" *ngIf="row.conflictResult">{{ row.conflictResult }}</span><small *ngIf="!row.conflictResult">—</small></td></ng-container>
        <ng-container matColumnDef="confirm"><th mat-header-cell *matHeaderCellDef>重新确认</th><td mat-cell *matCellDef="let row"><span class="chip stale" *ngIf="row.confirmStatus === '待重新确认'">待重新确认</span><span class="chip ok" *ngIf="row.confirmStatus === '已确认'">已确认</span><small *ngIf="!row.confirmStatus">—</small></td></ng-container>
        <ng-container matColumnDef="detail"><th mat-header-cell *matHeaderCellDef>说明</th><td mat-cell *matCellDef="let row">{{ row.detail }}</td></ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }.head h2 { margin: 0 0 5px; font-size: 20px; }.head p { margin: 0; color: #72807d; font-size: 12px; }
    .batches { padding: 12px 14px; margin-bottom: 14px; } .batches h3 { margin: 0 0 10px; font-size: 14px; }
    .toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }.toolbar span { color: #72807d; font-size: 11px; }.panel { width: 100%; background: white; border: 1px solid #d9e1df; }
    .batch { background: #e4eeec; color: #245060; border-radius: 3px; padding: 2px 7px; font-size: 10px; }
    .chip { border-radius: 10px; padding: 2px 8px; font-size: 10px; } .chip.pending { background: #f6e2c6; color: #8e681d; } .chip.keep { background: #e8f0f4; color: #2f6180; } .chip.take { background: #e7f3ee; color: #2e765a; } .chip.stale { background: #fae8e6; color: #a43c35; } .chip.ok { background: #e7f3ee; color: #2e765a; }
    .status { font-size: 10px; padding: 2px 8px; border-radius: 10px; background: #eef1f0; color: #5b6864; } .status.done { background: #e7f3ee; color: #2e765a; } .status.fail { background: #fae8e6; color: #a43c35; }
  `]
})
export class AuditPageComponent {
  private readonly store = inject(Store)
  private readonly api = inject(TailingsApiService)
  keyword = ''
  readonly columns = ['time', 'entity', 'batch', 'action', 'operator', 'conflict', 'confirm', 'detail']
  readonly batchColumns = ['id', 'time', 'items', 'status']
  readonly dataset$ = this.store.select(selectDataset)
  readonly filtered$ = this.store.select(selectDataset).pipe(map((dataset) => dataset.audit.filter((item) => !this.keyword || `${item.entityId} ${item.action} ${item.operator} ${item.detail} ${item.batchId ?? ''} ${item.conflictResult ?? ''} ${item.confirmStatus ?? ''}`.includes(this.keyword))))
  done(total: number, row: { items: Array<{ status: string }> }): number {
    void total
    return row.items.filter((item) => item.status === '写入成功').length
  }
  exportPackage(): void {
    this.store.select(selectDataset).subscribe((dataset) => {
      this.api.exportPackage(dataset).subscribe((blob) => {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = '尾矿库监测审阅包.json'; anchor.click(); URL.revokeObjectURL(url)
      })
    }).unsubscribe()
  }
}
