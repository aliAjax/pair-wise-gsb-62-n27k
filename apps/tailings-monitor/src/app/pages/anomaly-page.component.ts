import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { Anomaly, Crew, DispositionPlan, ExpertOpinion, FieldConflict, FieldReview, RawReading, ReviewFieldKey } from '../domain'
import { reviewFieldLabels } from '../domain'
import { OfflineSyncComponent } from '../components/offline-sync.component'
import { TailingsActions } from '../store/tailings.actions'
import { selectAnomalies, selectFilteredAnomalies, selectNotice, selectSelectedAnomalyContext } from '../store/tailings.selectors'

interface ReviewDraft {
  crew: Crew
  observed: string
  evidence: string
  reassessment: string
  planSuggestion: string
}

@Component({
  selector: 'app-anomaly-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule, OfflineSyncComponent],
  template: `
    <section class="page">
      <div class="metrics">
        <article><span>待现场复核</span><strong>{{ count('待现场复核') }}</strong><small>不得直接关闭</small></article>
        <article><span>调查与审批</span><strong>{{ count('原因调查中') + count('待负责人审批') }}</strong><small>多专业意见并存</small></article>
        <article><span>应急联动</span><strong>{{ count('应急联动') }}</strong><small>重大异常强制联动</small></article>
        <article><span>已关闭</span><strong>{{ count('已关闭') }}</strong><small>具备复测与签批</small></article>
      </div>

      <div class="notice" *ngIf="notice$ | async as notice"><b>批次/冲突提示</b><span>{{ notice }}</span></div>

      <app-offline-sync />

      <div class="toolbar"><mat-form-field appearance="outline"><mat-label>搜索异常</mat-label><input matInput [(ngModel)]="localKeyword" (ngModelChange)="updateKeyword($event)" /></mat-form-field><mat-form-field appearance="outline"><mat-label>状态</mat-label><mat-select [(ngModel)]="localStatus" (ngModelChange)="updateStatus($event)"><mat-option value="全部">全部</mat-option><mat-option *ngFor="let item of statuses" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field></div>
      <div class="split">
        <table mat-table [dataSource]="filtered$ | async" class="panel">
          <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>异常</th><td mat-cell *matCellDef="let row"><b>{{ row.title }}</b><small class="sub">{{ row.id }} · {{ row.pointId }}</small></td></ng-container>
          <ng-container matColumnDef="severity"><th mat-header-cell *matHeaderCellDef>级别</th><td mat-cell *matCellDef="let row"><span class="severity" [class.major]="row.severity === '重大'">{{ row.severity }}</span></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row">{{ row.status }}<small class="sub" *ngIf="openConflictTotal(row)">{{ openConflictTotal(row) }}个待核对</small><small class="sub stale" *ngIf="staleTotal(row)">待重新确认</small></td></ng-container>
          <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let row">V{{ row.version }}</td></ng-container>
          <ng-container matColumnDef="open"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button (click)="select(row.id)">审阅</button></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected]="row.id === (context$ | async)?.anomaly.id"></tr>
        </table>
        <div class="panel detail" *ngIf="context$ | async as ctx">
          <ng-container *ngIf="ctx.anomaly as selected; else noSelection">
            <div class="detail-head"><div><span>{{ selected.id }} · V{{ selected.version }} · 触发读数 {{ selected.triggerReadingId }} · 最新读数 {{ ctx.latestReading?.id ?? '—' }}（{{ ctx.latestReading?.value }}{{ ctx.latestReading?.unit }}）</span><h2>{{ selected.title }}</h2><p>{{ selected.observedValue }}</p></div><span class="severity" [class.major]="selected.severity === '重大'">{{ selected.severity }}</span></div>

            <div class="state-band">
              <article [class.blocked]="ctx.hasOpenConflict"><b>冲突结果</b><span>{{ ctx.openConflictCount ? ctx.openConflictCount + '个待核对' : '无未决冲突' }}</span></article>
              <article [class.blocked]="ctx.needsReconfirm"><b>重新确认</b><span>{{ ctx.needsReconfirm ? '引用读数变化，结论待重新确认' : '全部结论已确认' }}</span></article>
              <article><b>批次来源</b><span>{{ sourceSummary(selected) }}</span></article>
            </div>

            <h3>冲突核对（两个班组的不同改法）</h3>
            <div class="conflict" *ngFor="let conflict of selected.conflicts">
              <div class="conflict-title"><span class="tag">{{ fieldLabel(conflict.field) }}</span><span class="status" [class.pending]="conflict.outcome === '待核对'" [class.resolved]="conflict.outcome !== '待核对'">{{ conflict.outcome }}</span></div>
              <div class="conflict-sides">
                <div class="side first"><small>先到 · {{ conflict.first.crew }} · {{ conflict.first.batchId }}</small><p>{{ conflict.first.value }}</p></div>
                <div class="side later"><small>后到 · {{ conflict.later.crew }} · {{ conflict.later.batchId }}</small><p>{{ conflict.later.value }}</p></div>
              </div>
              <div class="conflict-actions" *ngIf="conflict.outcome === '待核对'">
                <button mat-stroked-button (click)="resolve(conflict, '保留先到')">保留先到</button>
                <button mat-flat-button color="primary" (click)="resolve(conflict, '采用后到')">采用后到</button>
                <small>重大异常在全部冲突核对完成前不能送负责人审批或关闭。</small>
              </div>
              <div class="conflict-actions" *ngIf="conflict.outcome !== '待核对'"><small>{{ conflict.resolvedBy }} 于 {{ conflict.resolvedAt.replace('T', ' ').slice(0, 16) }} 核对</small></div>
            </div>
            <p class="empty" *ngIf="!selected.conflicts.length">暂无冲突：先到字段已自动合并。</p>

            <h3>当前合并字段（按异常当前版本）</h3>
            <div class="merged">
              <article *ngFor="let key of mergedKeys(selected)"><b>{{ fieldLabel(key) }}</b><p>{{ selected.mergedFields?.[key]?.value }}</p><footer><span class="tag">{{ selected.mergedFields?.[key]?.crew }}</span><small>{{ selected.mergedFields?.[key]?.batchId }}</small><i [class.stale]="selected.mergedFields?.[key]?.confirmStatus === '待重新确认'">{{ selected.mergedFields?.[key]?.confirmStatus }}</i></footer></article>
            </div>

            <h3>现场复核（在线按字段合并）</h3>
            <div class="review-form">
              <mat-form-field appearance="outline"><mat-label>班组</mat-label><mat-select [(ngModel)]="fieldForm.crew"><mat-option value="甲班">甲班</mat-option><mat-option value="乙班">乙班</mat-option></mat-select></mat-form-field>
              <mat-form-field appearance="outline" class="wide"><mat-label>现场观察</mat-label><textarea matInput rows="2" [(ngModel)]="fieldForm.observed"></textarea></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>证据清单</mat-label><input matInput [(ngModel)]="fieldForm.evidence" /></mat-form-field>
              <mat-form-field appearance="outline"><mat-label>重新评估</mat-label><input matInput [(ngModel)]="fieldForm.reassessment" /></mat-form-field>
              <mat-form-field appearance="outline" class="wide"><mat-label>处置建议</mat-label><input matInput [(ngModel)]="fieldForm.planSuggestion" /></mat-form-field>
              <button mat-flat-button color="primary" (click)="submitReview(selected, ctx.latestReading)">提交复核（合并到当前版本）</button>
              <small class="hint">只提交已填字段；与先到内容不同的字段不会覆盖，先挂起待核对。</small>
            </div>
            <div class="records" *ngFor="let review of selected.fieldReviews">
              <b>{{ review.inspector }} · V{{ review.version }} <span class="tag">{{ review.crew }}</span><small>批次 {{ review.batchId }} · 引用 {{ review.basedOnReadingId }}</small><i [class.stale]="review.confirmStatus === '待重新确认'">{{ review.confirmStatus }}</i></b>
              <p>{{ review.observed }}</p><span>{{ review.reassessment }} · {{ review.evidence }}</span>
            </div>

            <h3>专业意见</h3>
            <div class="opinion-form"><mat-form-field appearance="outline"><mat-label>专业</mat-label><mat-select [(ngModel)]="opinionForm.discipline"><mat-option *ngFor="let item of disciplines" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline" class="wide"><mat-label>意见</mat-label><input matInput [(ngModel)]="opinionForm.content" /></mat-form-field><button mat-button (click)="addOpinion(selected)">补充意见</button></div>
            <div class="opinions"><article *ngFor="let opinion of selected.opinions"><b>{{ opinion.discipline }}专家 {{ opinion.specialist }}</b><span>{{ opinion.conclusion }}</span><p>{{ opinion.content }}</p></article></div>

            <h3>处置方案与会签</h3>
            <div class="plan-source"><span class="tag">{{ selected.plan.crew || '—' }}</span><small>批次来源 {{ selected.plan.batchId || '—' }} · 引用读数 {{ selected.plan.basedOnReadingId || '—' }}</small><i [class.stale]="selected.plan.confirmStatus === '待重新确认'">{{ selected.plan.confirmStatus || '已确认' }}</i></div>
            <div class="plan-form"><mat-form-field appearance="outline"><mat-label>措施</mat-label><mat-select [(ngModel)]="planForm.action"><mat-option *ngFor="let item of actions" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline"><mat-label>责任方</mat-label><input matInput [(ngModel)]="planForm.owner" /></mat-form-field><mat-form-field appearance="outline" class="wide"><mat-label>关闭条件</mat-label><textarea matInput rows="2" [(ngModel)]="planForm.conditions"></textarea></mat-form-field><mat-form-field appearance="outline"><mat-label>截止</mat-label><input matInput type="datetime-local" [(ngModel)]="planForm.deadline" /></mat-form-field><button mat-button (click)="savePlan(selected)">提交审批</button></div>

            <div class="reading-band">
              <div><b>引用读数变化演练</b><span>新读数写入后，尚未批准的复核结论与方案草案立即失效。</span></div>
              <mat-form-field appearance="outline"><mat-label>新{{ ctx.point?.type }}读数（{{ ctx.point?.unit }}）</mat-label><input matInput type="number" [(ngModel)]="newReadingValue" /></mat-form-field>
              <button mat-stroked-button (click)="registerReading(selected)">写入新读数</button>
              <button mat-stroked-button [disabled]="!ctx.needsReconfirm" (click)="reconfirm(selected)">基于最新读数重新确认</button>
            </div>

            <div class="approval-band">
              <div><b>{{ selected.plan.approvedBy || '尚未审批' }}</b><span>{{ selected.plan.conditions }}</span><em class="block" *ngIf="ctx.approvalBlocked">⛔ {{ ctx.approvalBlocked }}</em><em class="block" *ngIf="ctx.closeBlocked && selected.plan.approvedBy">⛔ {{ ctx.closeBlocked }}</em></div>
              <button mat-flat-button color="primary" [disabled]="!!ctx.approvalBlocked" [title]="ctx.approvalBlocked" (click)="approve(selected)">负责人审批</button>
              <button mat-button color="warn" (click)="emergency(selected)">应急联动</button>
              <button mat-button [disabled]="!!ctx.closeBlocked || selected.status === '已关闭'" [title]="ctx.closeBlocked" (click)="close(selected)">关闭异常</button>
            </div>
          </ng-container>
          <ng-template #noSelection><p>请选择异常。</p></ng-template>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.metrics { display: grid; grid-template-columns: repeat(4, 1fr); background: white; border: 1px solid #d9e1df; margin-bottom: 14px; }.metrics article { padding: 16px 18px; border-right: 1px solid #e2e7e6; }.metrics article:last-child { border: 0; }.metrics span, .metrics strong, .metrics small { display: block; }.metrics span { color: #72807d; font-size: 12px; }.metrics strong { font-size: 26px; color: #245060; margin: 6px 0; }.metrics small { color: #98a4a0; font-size: 10px; }
    .notice { display: flex; gap: 10px; align-items: center; background: #eef5f4; border-left: 3px solid #315d6e; padding: 8px 12px; margin-bottom: 12px; font-size: 11px; } .notice b { color: #245060; } .notice span { color: #48544f; }
    .toolbar { display: flex; gap: 10px; margin-bottom: 10px; }.split { display: grid; grid-template-columns: minmax(560px,1fr) 560px; gap: 14px; align-items: start; }.panel { background: white; border: 1px solid #d9e1df; } table { width: 100%; }.selected { background: #eef5f4; }.sub { display: block; color: #7c8986; font-size: 10px; margin-top: 3px; }.sub.stale { color: #a23b34; }.severity { padding: 3px 7px; border-radius: 3px; background: #f7edd6; color: #8e681d; font-size: 11px; }.severity.major { background: #fae7e5; color: #a23b34; }
    .detail { padding: 16px; max-height: none; }.detail-head { display: flex; justify-content: space-between; align-items: start; border-bottom: 1px solid #e1e6e5; padding-bottom: 12px; }.detail-head span { color: #74827f; font-size: 10px; }.detail-head h2 { margin: 4px 0; font-size: 18px; }.detail-head p { margin: 0; color: #65736f; font-size: 12px; }.detail h3 { font-size: 13px; margin: 16px 0 8px; }
    .state-band { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 10px; } .state-band article { background: #f5f8f7; border: 1px solid #e2e7e6; padding: 8px 10px; } .state-band b, .state-band span { display: block; font-size: 10px; } .state-band b { color: #72807d; } .state-band span { color: #245060; margin-top: 3px; } .state-band article.blocked { background: #fdf1f0; border-color: #ecc4c0; } .state-band article.blocked span { color: #a23b34; }
    .tag { background: #e4eeec; color: #245060; border-radius: 3px; padding: 1px 6px; font-size: 10px; font-style: normal; }
    .conflict { border: 1px solid #ecd9c2; background: #fdf8f0; padding: 10px; margin-bottom: 8px; } .conflict-title { display: flex; justify-content: space-between; align-items: center; } .conflict-title .status { font-size: 10px; padding: 2px 8px; border-radius: 10px; } .conflict-title .status.pending { background: #f6e2c6; color: #8e681d; } .conflict-title .status.resolved { background: #e7f3ee; color: #2e765a; }
    .conflict-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 8px 0; } .side { border: 1px solid #e4ddce; background: white; padding: 7px 9px; } .side.later { border-left: 3px solid #c99f3d; } .side.first { border-left: 3px solid #315d6e; } .side small { color: #8a9693; font-size: 9px; } .side p { margin: 4px 0 0; font-size: 11px; }
    .conflict-actions { display: flex; align-items: center; gap: 8px; } .conflict-actions small { color: #a23b34; font-size: 10px; }
    .empty { color: #8a9693; font-size: 11px; }
    .merged { display: grid; gap: 6px; } .merged article { border-left: 3px solid #315d6e; background: #f5f8f7; padding: 7px 10px; } .merged b { font-size: 11px; } .merged p { margin: 3px 0; font-size: 11px; } .merged footer { display: flex; align-items: center; gap: 8px; } .merged small { color: #8a9693; font-size: 9px; } .merged i, .records i, .plan-source i { font-style: normal; font-size: 9px; color: #2e765a; margin-left: auto; } i.stale { color: #a23b34 !important; }
    .review-form, .opinion-form, .plan-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }.review-form .wide, .opinion-form .wide, .plan-form .wide { grid-column: 1 / -1; }.review-form button, .plan-form button { align-self: center; }.review-form .hint { grid-column: 1 / -1; color: #8a9693; font-size: 10px; }
    .records { border-left: 3px solid #315d6e; background: #f5f8f7; padding: 9px; margin-top: 7px; display: grid; gap: 4px; }.records p { margin: 0; font-size: 12px; }.records span { color: #72807d; font-size: 10px; }.records b { display: flex; align-items: center; gap: 6px; font-size: 11px; }.records small { color: #8a9693; font-weight: 400; }
    .opinions article { border-bottom: 1px solid #e2e7e6; padding: 9px 0; display: grid; grid-template-columns: 1fr auto; gap: 4px; }.opinions p { grid-column: 1 / -1; margin: 0; font-size: 12px; }.opinions span { color: #8a6720; font-size: 10px; }
    .plan-source { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; } .plan-source small { color: #8a9693; font-size: 10px; }
    .reading-band { display: flex; align-items: center; gap: 8px; background: #f3f6f8; border-left: 3px solid #2f6180; padding: 8px 10px; margin-top: 10px; } .reading-band div { flex: 1; } .reading-band b, .reading-band span { display: block; } .reading-band b { font-size: 11px; } .reading-band span { color: #72807d; font-size: 10px; } .reading-band mat-form-field { width: 150px; }
    .approval-band { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 7px; background: #f6f0df; border-left: 3px solid #c99f3d; padding: 10px; margin-top: 12px; }.approval-band b, .approval-band span, .approval-band em { display: block; }.approval-band span { color: #746c55; font-size: 10px; margin-top: 4px; }.approval-band em.block { color: #a23b34; font-size: 10px; font-style: normal; margin-top: 4px; }
  `]
})
export class AnomalyPageComponent {
  private readonly store = inject(Store)
  readonly filtered$ = this.store.select(selectFilteredAnomalies)
  readonly context$ = this.store.select(selectSelectedAnomalyContext)
  readonly notice$ = this.store.select(selectNotice)
  private readonly all$ = this.store.select(selectAnomalies)
  readonly columns = ['title', 'severity', 'status', 'version', 'open']
  readonly statuses: Anomaly['status'][] = ['待现场复核', '原因调查中', '待负责人审批', '应急联动', '已关闭']
  readonly disciplines: ExpertOpinion['discipline'][] = ['坝体', '水文', '岩土', '应急']
  readonly actions: DispositionPlan['action'][] = ['加密监测', '降低库水位', '疏通排水', '应急撤离准备', '工程加固']
  localKeyword = ''
  localStatus: Anomaly['status'] | '全部' = '全部'
  fieldForm: ReviewDraft = { crew: '乙班', observed: '', evidence: '', reassessment: '', planSuggestion: '' }
  opinionForm = { discipline: '坝体' as ExpertOpinion['discipline'], content: '' }
  planForm = { action: '加密监测' as DispositionPlan['action'], owner: '坝体安全组', conditions: '', deadline: '2026-09-29T18:00' }
  newReadingValue: number | null = null

  fieldLabel(key: ReviewFieldKey): string { return reviewFieldLabels[key] }
  mergedKeys(selected: Anomaly): ReviewFieldKey[] {
    return (['observed', 'evidence', 'reassessment', 'planSuggestion'] as ReviewFieldKey[]).filter((key) => selected.mergedFields?.[key])
  }
  openConflictTotal(row: Anomaly): number { return row.conflicts.filter((item) => item.outcome === '待核对').length }
  staleTotal(row: Anomaly): boolean {
    return row.fieldReviews.some((review) => review.confirmStatus === '待重新确认') || row.plan.confirmStatus === '待重新确认'
  }
  sourceSummary(selected: Anomaly): string {
    const crews = new Set<string>()
    Object.values(selected.mergedFields ?? {}).forEach((field) => field?.crew && crews.add(field.crew))
    return crews.size ? `${[...crews].join('/')} · ${selected.fieldReviews[0]?.batchId ?? selected.plan.batchId ?? '—'}` : '暂无复核来源'
  }

  count(status: Anomaly['status']): number { let value = 0; this.all$.subscribe((items) => { value = items.filter((item) => item.status === status).length }).unsubscribe(); return value }
  updateKeyword(value: string): void { this.store.dispatch(TailingsActions.updateKeyword({ keyword: value })) }
  updateStatus(value: Anomaly['status'] | '全部'): void { this.store.dispatch(TailingsActions.updateStatus({ status: value })) }
  select(id: string): void { this.store.dispatch(TailingsActions.selectAnomaly({ anomalyId: id })) }

  submitReview(anomaly: Anomaly, latestReading?: RawReading): void {
    const review: FieldReview = {
      id: `FR-${Date.now()}`,
      inspector: this.fieldForm.crew,
      arrivedAt: new Date().toISOString(),
      observed: this.fieldForm.observed,
      evidence: this.fieldForm.evidence,
      reassessment: this.fieldForm.reassessment,
      version: 0
    }
    this.store.dispatch(TailingsActions.submitFieldReview({ anomalyId: anomaly.id, review, crew: this.fieldForm.crew, basedOnReadingId: latestReading?.id ?? anomaly.triggerReadingId, planSuggestion: this.fieldForm.planSuggestion }))
  }
  addOpinion(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.addExpertOpinion({ anomalyId: anomaly.id, opinion: { id: `OP-${Date.now()}`, specialist: '当前用户', ...this.opinionForm, conclusion: '补充证据', createdAt: new Date().toISOString() } })) }
  savePlan(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.saveDispositionPlan({ anomalyId: anomaly.id, plan: { id: anomaly.plan.id, ...this.planForm, emergencyLinked: anomaly.plan.emergencyLinked, approvedBy: '', approvedAt: '', batchId: 'online', crew: '甲班', basedOnReadingId: anomaly.plan.basedOnReadingId, confirmStatus: '已确认' } })) }
  approve(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.approvePlan({ anomalyId: anomaly.id, approver: '负责人 何清', note: '同意执行，严格执行关闭条件。' })) }
  emergency(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.createEmergencyLink({ anomalyId: anomaly.id, note: '重大异常联动应急值班，通知下游巡查。' })) }
  close(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.closeAnomaly({ anomalyId: anomaly.id, note: '复测数据稳定，关闭条件已满足。' })) }
  resolve(conflict: FieldConflict, outcome: '保留先到' | '采用后到'): void { this.store.dispatch(TailingsActions.resolveConflict({ anomalyId: conflict.anomalyId, conflictId: conflict.id, outcome, operator: '值班负责人' })) }
  registerReading(anomaly: Anomaly): void {
    const value = this.newReadingValue
    if (value === null) return
    this.store.dispatch(TailingsActions.registerReading({ pointId: anomaly.pointId, reading: { id: `RD-${Date.now()}`, pointId: anomaly.pointId, value, unit: anomaly.pointId === 'P-W01' ? 'm' : anomaly.pointId === 'P-S01' ? 'L/s' : anomaly.pointId === 'P-R01' ? 'mm/h' : 'mm', capturedAt: new Date().toISOString(), deviceId: 'MANUAL', quality: '有效' } }))
  }
  reconfirm(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.reconfirmConclusions({ anomalyId: anomaly.id, operator: '当前用户' })) }
}
