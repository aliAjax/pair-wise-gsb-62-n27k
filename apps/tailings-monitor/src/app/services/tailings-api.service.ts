import { HttpClient } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable, catchError, of } from 'rxjs'
import { buildReviewPackage, type ReviewPackage, type TailingsDataset } from '../domain'
import { seedDataset } from '../data/seed'

@Injectable({ providedIn: 'root' })
export class TailingsApiService {
  private readonly http = inject(HttpClient)
  private readonly baseUrl = (globalThis as { __TAILINGS_API__?: string }).__TAILINGS_API__ ?? '/api'

  loadDataset(): Observable<TailingsDataset> {
    return this.http.get<TailingsDataset>(`${this.baseUrl}/tailings/snapshot`).pipe(catchError(() => of(structuredClone(seedDataset))))
  }

  /** 审阅包：含批次来源、冲突结果、重新确认状态与完整审计轨迹 */
  exportPackage(payload: TailingsDataset): Observable<Blob> {
    const reviewPackage: ReviewPackage = buildReviewPackage(payload)
    const fallback = new Blob([JSON.stringify(reviewPackage, null, 2)], { type: 'application/json' })
    return this.http
      .post(`${this.baseUrl}/tailings/export`, reviewPackage, { responseType: 'blob' })
      .pipe(catchError(() => of(fallback)))
  }
}
