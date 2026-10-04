import { CommonModule } from '@angular/common'
import { Component, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatTableModule } from '@angular/material/table'
import { Store } from '@ngrx/store'
import type { Anomaly, DispositionPlan, ExpertOpinion, FieldReview, OfflineReviewItem, SyncBatch } from '../domain'
import { TailingsActions } from '../store/tailings.actions'
import { selectAnomalies, selectFilteredAnomalies, selectSelectedAnomaly, selectSyncBatches } from '../store/tailings.selectors'

@Component({
  selector: 'app-anomaly-page',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTableModule],
  template: `
    <section class="page">
      <div class="metrics">
        <article><span>待现场复核</span><strong>{{ count('待现场复核') }}</strong><small>不得直接关闭</small></article>
        <article><span>调查与审批</span><strong>{{ count('原因调查中') + count('待负责人审批') }}</strong><small>多专业意见并存</small></article>
        <article><span>应急联动</span><strong>{{ count('应急联动') }}</strong><small>重大异常强制联动</small></article>
        <article><span>已关闭</span><strong>{{ count('已关闭') }}</strong><small>具备复测与签批</small></article>
      </div>
      <div class="panel batch-panel">
        <div class="batch-head"><div><h3>离线复核批次</h3><p>坝区断网时填写离线复核单，回连后按异常当前版本合并：先到先收，后到不同改法登记待核对；重复上传不产生新审计。</p></div><button mat-button (click)="loadDemoBatch()">载入演示离线单</button></div>
        <div class="batch-grid">
          <div class="batch-form">
            <mat-form-field appearance="outline"><mat-label>班组</mat-label><mat-select [(ngModel)]="offlineForm.team"><mat-option *ngFor="let item of teams" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>填报人</mat-label><input matInput [(ngModel)]="offlineForm.inspector" /></mat-form-field>
            <mat-form-field appearance="outline" class="wide"><mat-label>异常</mat-label><mat-select [(ngModel)]="offlineForm.anomalyId"><mat-option *ngFor="let item of all$ | async" [value]="item.id">{{ item.id }} · {{ item.title }}（当前V{{ item.version }}）</mat-option></mat-select></mat-form-field>
            <mat-form-field appearance="outline" class="wide"><mat-label>现场观察</mat-label><textarea matInput rows="2" [(ngModel)]="offlineForm.observed"></textarea></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>证据清单</mat-label><input matInput [(ngModel)]="offlineForm.evidence" /></mat-form-field>
            <mat-form-field appearance="outline"><mat-label>处置建议</mat-label><input matInput [(ngModel)]="offlineForm.reassessment" /></mat-form-field>
            <button mat-button (click)="addDraftItem()">加入批次</button>
          </div>
          <div class="batch-draft">
            <h4>待上传清单（{{ draftItems.length }}项）</h4>
            <article *ngFor="let item of draftItems; let i = index"><b>{{ item.team }} · {{ item.inspector }}</b><span>{{ item.anomalyId }} · 基于V{{ item.baseVersion }}</span><p>{{ item.reassessment }}</p><button mat-button color="warn" (click)="removeDraftItem(i)">移除</button></article>
            <p *ngIf="!draftItems.length" class="empty">暂无待上传复核项。</p>
            <label class="simulate"><input type="checkbox" [(ngModel)]="simulateFailure" /> 模拟断网中断（仅写入第1项后失败）</label>
            <button mat-flat-button color="primary" [disabled]="!draftItems.length" (click)="uploadBatch()">回连上传批次</button>
          </div>
          <div class="batch-records">
            <h4>批次记录</h4>
            <article *ngFor="let batch of batches$ | async">
              <div class="batch-title"><b>{{ batch.id }}</b><span class="tag" [class.warn]="batch.status === '部分失败'">{{ batch.status }}</span></div>
              <small>{{ batch.team }} · {{ batch.createdAt.replace('T', ' ').slice(0, 16) }} · 已写入{{ batch.appliedItemIds.length }}/{{ batch.items.length }}项</small>
              <p *ngIf="batch.failureReason" class="failure">{{ batch.failureReason }}</p>
              <div class="receipt" *ngFor="let receipt of batch.results"><span class="tag" [class.ok]="receipt.outcome === '已接受'" [class.warn]="receipt.outcome === '待核对'">{{ receipt.outcome }}</span><span>{{ receipt.itemId }} → {{ receipt.anomalyId }}：{{ receipt.detail }}</span></div>
              <button mat-flat-button color="primary" *ngIf="batch.status === '部分失败'" (click)="resumeBatch(batch)">从断点恢复（剩余{{ batch.items.length - batch.appliedItemIds.length }}项）</button>
            </article>
            <p *ngIf="!(batches$ | async)?.length" class="empty">尚未上传离线批次。</p>
          </div>
        </div>
      </div>
      <div class="toolbar"><mat-form-field appearance="outline"><mat-label>搜索异常</mat-label><input matInput [(ngModel)]="localKeyword" (ngModelChange)="updateKeyword($event)" /></mat-form-field><mat-form-field appearance="outline"><mat-label>状态</mat-label><mat-select [(ngModel)]="localStatus" (ngModelChange)="updateStatus($event)"><mat-option value="全部">全部</mat-option><mat-option *ngFor="let item of statuses" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field></div>
      <div class="split">
        <table mat-table [dataSource]="filtered$ | async" class="panel">
          <ng-container matColumnDef="title"><th mat-header-cell *matHeaderCellDef>异常</th><td mat-cell *matCellDef="let row"><b>{{ row.title }}</b><small class="sub">{{ row.id }} · {{ row.pointId }}<span class="flag warn" *ngIf="openConflicts(row)">待核对{{ openConflicts(row) }}</span><span class="flag stale" *ngIf="staleReviews(row)">待重新确认{{ staleReviews(row) }}</span></small></td></ng-container>
          <ng-container matColumnDef="severity"><th mat-header-cell *matHeaderCellDef>级别</th><td mat-cell *matCellDef="let row"><span class="severity" [class.major]="row.severity === '重大'">{{ row.severity }}</span></td></ng-container>
          <ng-container matColumnDef="status"><th mat-header-cell *matHeaderCellDef>状态</th><td mat-cell *matCellDef="let row">{{ row.status }}</td></ng-container>
          <ng-container matColumnDef="version"><th mat-header-cell *matHeaderCellDef>版本</th><td mat-cell *matCellDef="let row">V{{ row.version }}</td></ng-container>
          <ng-container matColumnDef="open"><th mat-header-cell *matHeaderCellDef></th><td mat-cell *matCellDef="let row"><button mat-button (click)="select(row.id)">审阅</button></td></ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr><tr mat-row *matRowDef="let row; columns: columns" [class.selected]="row.id === (selected$ | async)?.id"></tr>
        </table>
        <div class="panel detail" *ngIf="selected$ | async as selected">
          <div class="detail-head"><div><span>{{ selected.id }} · V{{ selected.version }}</span><h2>{{ selected.title }}</h2><p>{{ selected.observedValue }}</p></div><span class="severity" [class.major]="selected.severity === '重大'">{{ selected.severity }}</span></div>
          <div class="block-banner" *ngIf="blockReason(selected)">{{ blockReason(selected) }}</div>
          <h3>现场复核</h3>
          <div class="review-form"><mat-form-field appearance="outline" class="wide"><mat-label>现场观察</mat-label><textarea matInput rows="2" [(ngModel)]="fieldForm.observed"></textarea></mat-form-field><mat-form-field appearance="outline"><mat-label>证据清单</mat-label><input matInput [(ngModel)]="fieldForm.evidence" /></mat-form-field><mat-form-field appearance="outline"><mat-label>重新评估</mat-label><input matInput [(ngModel)]="fieldForm.reassessment" /></mat-form-field><button mat-flat-button color="primary" (click)="submitReview(selected)">提交复核版本</button></div>
          <div class="records" *ngFor="let review of selected.fieldReviews" [class.stale]="review.confirmStatus === '待重新确认'">
            <b>{{ review.inspector }} · V{{ review.version }}<span class="tag ok" *ngIf="review.confirmStatus === '有效'">有效</span><span class="tag warn" *ngIf="review.confirmStatus === '待重新确认'">待重新确认</span></b>
            <p>{{ review.observed }}</p><span>{{ review.reassessment }} · {{ review.evidence }}</span>
            <small>批次来源：{{ review.batchId }} · {{ review.team }} · 确认于{{ review.confirmedAt.replace('T', ' ').slice(0, 16) }}</small>
            <button mat-button color="primary" *ngIf="review.confirmStatus === '待重新确认'" (click)="reconfirm(selected, review)">对照新读数重新确认</button>
          </div>
          <h3>待核对冲突</h3>
          <div class="conflicts" *ngIf="selected.pendingConflicts.length; else noConflict">
            <article *ngFor="let conflict of selected.pendingConflicts" [class.resolved]="conflict.status !== '待核对'">
              <div><b>{{ conflict.team }} · {{ conflict.inspector }}</b><span class="tag" [class.warn]="conflict.status === '待核对'" [class.ok]="conflict.status === '已采纳'">{{ conflict.status }}</span></div>
              <p>{{ conflict.observed }}</p><span>{{ conflict.reassessment }} · {{ conflict.evidence }}</span>
              <small>批次来源：{{ conflict.batchId }} · 离线记录于{{ conflict.recordedAt.replace('T', ' ').slice(0, 16) }}<ng-container *ngIf="conflict.resolvedBy"> · {{ conflict.resolvedBy }}处理</ng-container></small>
              <div class="conflict-actions" *ngIf="conflict.status === '待核对'"><button mat-button color="primary" (click)="resolveConflict(selected, conflict.id, '已采纳')">采纳为复核版本</button><button mat-button color="warn" (click)="resolveConflict(selected, conflict.id, '已驳回')">驳回</button></div>
            </article>
          </div>
          <ng-template #noConflict><p class="empty">暂无后到改法冲突。</p></ng-template>
          <h3>专业意见</h3>
          <div class="opinion-form"><mat-form-field appearance="outline"><mat-label>专业</mat-label><mat-select [(ngModel)]="opinionForm.discipline"><mat-option *ngFor="let item of disciplines" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline" class="wide"><mat-label>意见</mat-label><input matInput [(ngModel)]="opinionForm.content" /></mat-form-field><button mat-button (click)="addOpinion(selected)">补充意见</button></div>
          <div class="opinions"><article *ngFor="let opinion of selected.opinions"><b>{{ opinion.discipline }}专家 {{ opinion.specialist }}</b><span>{{ opinion.conclusion }}</span><p>{{ opinion.content }}</p></article></div>
          <h3>处置方案与会签</h3>
          <div class="plan-form"><mat-form-field appearance="outline"><mat-label>措施</mat-label><mat-select [(ngModel)]="planForm.action"><mat-option *ngFor="let item of actions" [value]="item">{{ item }}</mat-option></mat-select></mat-form-field><mat-form-field appearance="outline"><mat-label>责任方</mat-label><input matInput [(ngModel)]="planForm.owner" /></mat-form-field><mat-form-field appearance="outline" class="wide"><mat-label>关闭条件</mat-label><textarea matInput rows="2" [(ngModel)]="planForm.conditions"></textarea></mat-form-field><mat-form-field appearance="outline"><mat-label>截止</mat-label><input matInput type="datetime-local" [(ngModel)]="planForm.deadline" /></mat-form-field><button mat-button [disabled]="!canSubmitPlan(selected)" (click)="savePlan(selected)">提交审批</button></div>
          <div class="approval-band"><div><b>{{ selected.plan.approvedBy || '尚未审批' }}</b><span>{{ selected.plan.conditions }}</span></div><button mat-flat-button color="primary" [disabled]="!canApprove(selected)" (click)="approve(selected)">负责人审批</button><button mat-button color="warn" (click)="emergency(selected)">应急联动</button><button mat-button [disabled]="!canClose(selected)" (click)="close(selected)">关闭异常</button></div>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .page { padding: 22px 28px 45px; }.metrics { display: grid; grid-template-columns: repeat(4, 1fr); background: white; border: 1px solid #d9e1df; margin-bottom: 14px; }.metrics article { padding: 16px 18px; border-right: 1px solid #e2e7e6; }.metrics article:last-child { border: 0; }.metrics span, .metrics strong, .metrics small { display: block; }.metrics span { color: #72807d; font-size: 12px; }.metrics strong { font-size: 26px; color: #245060; margin: 6px 0; }.metrics small { color: #98a4a0; font-size: 10px; }
    .toolbar { display: flex; gap: 10px; margin-bottom: 10px; }.split { display: grid; grid-template-columns: minmax(600px,1fr) 520px; gap: 14px; align-items: start; }.panel { background: white; border: 1px solid #d9e1df; } table { width: 100%; }.selected { background: #eef5f4; }.sub { display: block; color: #7c8986; font-size: 10px; margin-top: 3px; }.severity { padding: 3px 7px; border-radius: 3px; background: #f7edd6; color: #8e681d; font-size: 11px; }.severity.major { background: #fae7e5; color: #a23b34; }
    .detail { padding: 16px; }.detail-head { display: flex; justify-content: space-between; align-items: start; border-bottom: 1px solid #e1e6e5; padding-bottom: 12px; }.detail-head span { color: #74827f; font-size: 10px; }.detail-head h2 { margin: 4px 0; font-size: 18px; }.detail-head p { margin: 0; color: #65736f; font-size: 12px; }.detail h3 { font-size: 13px; margin: 16px 0 8px; }
    .review-form, .opinion-form, .plan-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }.review-form .wide, .opinion-form .wide, .plan-form .wide { grid-column: 1 / -1; }.review-form button, .plan-form button { align-self: center; }.records { border-left: 3px solid #315d6e; background: #f5f8f7; padding: 9px; margin-top: 7px; display: grid; gap: 4px; }.records.stale { border-left-color: #c0493f; background: #fbf1f0; }.records p { margin: 0; font-size: 12px; }.records span { color: #72807d; font-size: 10px; }.records small { color: #8b9794; font-size: 10px; }.records button { justify-self: start; }
    .opinions article { border-bottom: 1px solid #e2e7e6; padding: 9px 0; display: grid; grid-template-columns: 1fr auto; gap: 4px; }.opinions p { grid-column: 1 / -1; margin: 0; font-size: 12px; }.opinions span { color: #8a6720; font-size: 10px; }
    .approval-band { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 7px; background: #f6f0df; border-left: 3px solid #c99f3d; padding: 10px; margin-top: 12px; }.approval-band b, .approval-band span { display: block; }.approval-band span { color: #746c55; font-size: 10px; margin-top: 4px; }
    .batch-panel { padding: 14px 16px; margin-bottom: 14px; }.batch-head { display: flex; justify-content: space-between; align-items: center; }.batch-head h3 { margin: 0 0 4px; font-size: 14px; }.batch-head p { margin: 0; color: #72807d; font-size: 11px; }.batch-grid { display: grid; grid-template-columns: 1.2fr 1fr 1.4fr; gap: 14px; margin-top: 10px; }.batch-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; align-content: start; }.batch-form .wide { grid-column: 1 / -1; }.batch-form button { align-self: center; }
    .batch-draft, .batch-records { border-left: 1px solid #e2e7e6; padding-left: 14px; }.batch-draft h4, .batch-records h4 { margin: 0 0 8px; font-size: 12px; color: #405a64; }.batch-draft article, .batch-records article { border-bottom: 1px solid #e9eeec; padding: 7px 0; display: grid; gap: 3px; }.batch-draft article b, .batch-records article b { font-size: 11px; }.batch-draft article span, .batch-records article small { color: #7c8986; font-size: 10px; }.batch-draft article p { margin: 0; font-size: 11px; }.batch-draft article button { justify-self: start; }.simulate { display: flex; align-items: center; gap: 6px; color: #8a6720; font-size: 11px; margin: 10px 0 8px; }.empty { color: #98a4a0; font-size: 11px; }
    .batch-title { display: flex; align-items: center; gap: 8px; }.failure { margin: 0; color: #a23b34; font-size: 10px; }.receipt { display: flex; gap: 6px; align-items: baseline; font-size: 10px; color: #5d6b68; padding: 2px 0; }.tag { padding: 2px 6px; border-radius: 3px; background: #eceff1; color: #6b7a76; font-size: 10px; white-space: nowrap; }.tag.ok { background: #e3f2ec; color: #2e765a; }.tag.warn { background: #f8e4d9; color: #a5521f; }
    .flag { padding: 1px 5px; border-radius: 3px; margin-left: 5px; font-size: 9px; }.flag.warn { background: #f8e4d9; color: #a5521f; }.flag.stale { background: #fae7e5; color: #a23b34; }
    .block-banner { background: #fae7e5; border-left: 3px solid #c0493f; color: #8c322c; font-size: 11px; padding: 8px 10px; margin-top: 10px; }
    .conflicts article { border-left: 3px solid #d08a2d; background: #fdf6ea; padding: 9px; margin-top: 7px; display: grid; gap: 4px; }.conflicts article.resolved { border-left-color: #9aa5a2; background: #f4f6f5; }.conflicts article div { display: flex; justify-content: space-between; align-items: center; }.conflicts article b { font-size: 11px; }.conflicts article p { margin: 0; font-size: 12px; }.conflicts article span { color: #72807d; font-size: 10px; }.conflicts article small { color: #8b9794; font-size: 10px; }.conflict-actions { display: flex; gap: 6px; }
  `]
})
export class AnomalyPageComponent {
  private readonly store = inject(Store)
  readonly filtered$ = this.store.select(selectFilteredAnomalies)
  readonly selected$ = this.store.select(selectSelectedAnomaly)
  readonly all$ = this.store.select(selectAnomalies)
  readonly batches$ = this.store.select(selectSyncBatches)
  readonly columns = ['title', 'severity', 'status', 'version', 'open']
  readonly statuses: Anomaly['status'][] = ['待现场复核', '原因调查中', '待负责人审批', '应急联动', '已关闭']
  readonly disciplines: ExpertOpinion['discipline'][] = ['坝体', '水文', '岩土', '应急']
  readonly actions: DispositionPlan['action'][] = ['加密监测', '降低库水位', '疏通排水', '应急撤离准备', '工程加固']
  readonly teams = ['巡检一班', '巡检二班']
  localKeyword = ''
  localStatus: Anomaly['status'] | '全部' = '全部'
  fieldForm = { observed: '', evidence: '', reassessment: '' }
  opinionForm = { discipline: '坝体' as ExpertOpinion['discipline'], content: '' }
  planForm = { action: '加密监测' as DispositionPlan['action'], owner: '坝体安全组', conditions: '', deadline: '2026-09-29T18:00' }
  offlineForm = { team: '巡检一班', inspector: '宋立', anomalyId: '', observed: '', evidence: '', reassessment: '' }
  draftItems: OfflineReviewItem[] = []
  simulateFailure = false
  private draftSeq = 1
  count(status: Anomaly['status']): number { let value = 0; this.all$.subscribe((items) => { value = items.filter((item) => item.status === status).length }).unsubscribe(); return value }
  openConflicts(anomaly: Anomaly): number { return anomaly.pendingConflicts.filter((item) => item.status === '待核对').length }
  staleReviews(anomaly: Anomaly): number { return anomaly.fieldReviews.filter((item) => item.confirmStatus === '待重新确认').length }
  canSubmitPlan(anomaly: Anomaly): boolean { return !(anomaly.severity === '重大' && this.openConflicts(anomaly) > 0) }
  canApprove(anomaly: Anomaly): boolean {
    if (anomaly.severity === '重大' && (!anomaly.plan.emergencyLinked || this.openConflicts(anomaly) > 0)) return false
    return this.staleReviews(anomaly) === 0
  }
  canClose(anomaly: Anomaly): boolean {
    if (anomaly.status !== '待负责人审批' || this.staleReviews(anomaly) > 0) return false
    return !(anomaly.severity === '重大' && this.openConflicts(anomaly) > 0)
  }
  blockReason(anomaly: Anomaly): string {
    const reasons: string[] = []
    if (anomaly.severity === '重大' && this.openConflicts(anomaly) > 0) reasons.push(`存在${this.openConflicts(anomaly)}条未决冲突，重大异常在核对完成前不能送负责人审批或关闭`)
    if (this.staleReviews(anomaly) > 0) reasons.push(`${this.staleReviews(anomaly)}条复核结论因引用读数变化已失效，重新确认前不能审批或关闭`)
    return reasons.join('；')
  }
  updateKeyword(value: string): void { this.store.dispatch(TailingsActions.updateKeyword({ keyword: value })) }
  updateStatus(value: Anomaly['status'] | '全部'): void { this.store.dispatch(TailingsActions.updateStatus({ status: value })) }
  select(id: string): void { this.store.dispatch(TailingsActions.selectAnomaly({ anomalyId: id })) }
  submitReview(anomaly: Anomaly): void {
    const review: FieldReview = { id: `FR-${Date.now()}`, inspector: '宋立', arrivedAt: new Date().toISOString(), ...this.fieldForm, version: 0, team: '在线录入', batchId: '在线录入', sourceItemId: '', confirmStatus: '有效', confirmedAt: new Date().toISOString() }
    this.store.dispatch(TailingsActions.submitFieldReview({ anomalyId: anomaly.id, review }))
  }
  addOpinion(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.addExpertOpinion({ anomalyId: anomaly.id, opinion: { id: `OP-${Date.now()}`, specialist: '当前用户', ...this.opinionForm, conclusion: '补充证据', createdAt: new Date().toISOString() } })) }
  savePlan(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.saveDispositionPlan({ anomalyId: anomaly.id, plan: { id: anomaly.plan.id, ...this.planForm, emergencyLinked: anomaly.plan.emergencyLinked, approvedBy: '', approvedAt: '' } })) }
  approve(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.approvePlan({ anomalyId: anomaly.id, approver: '负责人 何清', note: '同意执行，严格执行关闭条件。' })) }
  emergency(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.createEmergencyLink({ anomalyId: anomaly.id, note: '重大异常联动应急值班，通知下游巡查。' })) }
  close(anomaly: Anomaly): void { this.store.dispatch(TailingsActions.closeAnomaly({ anomalyId: anomaly.id, note: '复测数据稳定，关闭条件已满足。' })) }
  reconfirm(anomaly: Anomaly, review: FieldReview): void { this.store.dispatch(TailingsActions.reconfirmReview({ anomalyId: anomaly.id, reviewId: review.id, operator: '当前用户' })) }
  resolveConflict(anomaly: Anomaly, conflictId: string, decision: '已采纳' | '已驳回'): void { this.store.dispatch(TailingsActions.resolveConflict({ anomalyId: anomaly.id, conflictId, decision, operator: '当前用户' })) }
  addDraftItem(): void {
    const anomalyId = this.offlineForm.anomalyId || this.currentAnomalyId()
    const anomaly = this.findAnomaly(anomalyId)
    if (!anomaly || !this.offlineForm.observed || !this.offlineForm.evidence || !this.offlineForm.reassessment) return
    this.draftItems = [...this.draftItems, { id: `OFF-${Date.now()}-${this.draftSeq++}`, anomalyId, team: this.offlineForm.team, inspector: this.offlineForm.inspector, observed: this.offlineForm.observed, evidence: this.offlineForm.evidence, reassessment: this.offlineForm.reassessment, recordedAt: new Date().toISOString(), baseVersion: anomaly.version }]
    this.offlineForm = { ...this.offlineForm, observed: '', evidence: '', reassessment: '' }
  }
  removeDraftItem(index: number): void { this.draftItems = this.draftItems.filter((_, i) => i !== index) }
  uploadBatch(): void {
    const batch: SyncBatch = { id: `BATCH-${Date.now()}`, team: this.offlineForm.team, createdAt: new Date().toISOString(), status: '已完成', failureReason: '', appliedItemIds: [], results: [], items: [...this.draftItems] }
    this.store.dispatch(TailingsActions.uploadOfflineBatch({ batch, failAfter: this.simulateFailure ? 1 : -1 }))
    this.draftItems = []
  }
  resumeBatch(batch: SyncBatch): void { this.store.dispatch(TailingsActions.resumeOfflineBatch({ batchId: batch.id })) }
  loadDemoBatch(): void {
    let anomalies: Anomaly[] = []
    this.all$.subscribe((items) => { anomalies = items }).unsubscribe()
    const water = anomalies.find((item) => item.id === 'AN-260929-02') ?? anomalies[0]
    const major = anomalies.find((item) => item.severity === '重大') ?? anomalies[0]
    if (!water || !major) return
    const stamp = Date.now()
    const at = (offsetMinutes: number) => new Date(stamp - offsetMinutes * 60000).toISOString()
    this.draftItems = [
      { id: `OFF-DEMO-${stamp}-1`, anomalyId: water.id, team: '巡检一班', inspector: '宋立', observed: '泄洪闸开度正常，库水位仍缓慢上涨，未见浑水。', evidence: '闸门开度照片、水位计现场读数', reassessment: '维持加密监测，2小时后复测水位。', recordedAt: at(95), baseVersion: water.version },
      { id: `OFF-DEMO-${stamp}-2`, anomalyId: water.id, team: '巡检二班', inspector: '韩冰', observed: '上游来水偏大，泄洪闸附近有漂浮物。', evidence: '入库流量估算记录、漂浮物照片', reassessment: '建议提前预泄降低库水位并通知下游。', recordedAt: at(80), baseVersion: water.version },
      { id: `OFF-DEMO-${stamp}-3`, anomalyId: major.id, team: '巡检二班', inspector: '韩冰', observed: '坝顶巡查未见新增裂缝，排水沟通畅。', evidence: '坝顶巡查照片、巡查轨迹', reassessment: '建议补充孔隙水压力监测后再定处置。', recordedAt: at(60), baseVersion: Math.max(0, major.version - 2) }
    ]
  }
  private currentAnomalyId(): string { let id = ''; this.selected$.subscribe((item) => { id = item?.id ?? '' }).unsubscribe(); return id }
  private findAnomaly(id: string): Anomaly | undefined { let found: Anomaly | undefined; this.all$.subscribe((items) => { found = items.find((item) => item.id === id) }).unsubscribe(); return found }
}
