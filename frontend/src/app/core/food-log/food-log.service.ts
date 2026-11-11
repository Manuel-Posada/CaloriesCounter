import { HttpClient, HttpEventType, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, concat, filter, finalize, map, of, startWith, switchMap, tap, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CatalogFood, FoodLog, FoodLogCreated, FoodLogDetail, Page, PresignResponse } from '../models';
import { PreferencesService } from '../preferences.service';
import { PipelineService } from './pipeline.service';

export type AnalyzeEvent =
  | { step: 'presign' }
  | { step: 'upload'; progress: number }
  | { step: 'infer' }
  | { step: 'done'; result: FoodLogCreated };

@Injectable({ providedIn: 'root' })
export class FoodLogService {
  private readonly http = inject(HttpClient);
  private readonly pipeline = inject(PipelineService);
  private readonly prefs = inject(PreferencesService);
  private readonly api = environment.apiUrl;

  /** Lista de registros en memoria para sincronizar la galería deslizable entre Historial y Resultado. */
  readonly cachedHistory = signal<FoodLog[]>([]);
  /** Paginación compartida entre Historial y la galería del resultado. */
  readonly historyHasMore = signal(false);
  readonly historyLoading = signal(false);
  private historyPage = 0;
  private readonly detailCache = new Map<number, FoodLogDetail>();

  /** Paso 1: URL prefirmada de subida. */
  presign(contentType: string): Observable<PresignResponse> {
    return this.http.post<PresignResponse>(`${this.api}/uploads/presign/`, { content_type: contentType });
  }

  /** Paso 2: PUT directo a R2 (sin pasar por Django). Emite 0-100 y completa al terminar. */
  uploadToR2(p: PresignResponse, blob: Blob): Observable<number> {
    return this.http
      .put(p.upload_url, blob, { headers: p.headers, reportProgress: true, observe: 'events' })
      .pipe(
        filter((e) => e.type === HttpEventType.UploadProgress),
        map((e) => {
          const ev = e as { loaded: number; total?: number };
          return ev.total ? Math.round((ev.loaded / ev.total) * 100) : 0;
        }),
      );
  }

  /** Paso 3: dispara la inferencia (Modal + Gemini) y registra el FoodLog. */
  create(idImagenR2: string, f35Mm: number | null = null): Observable<FoodLogCreated> {
    const body: Record<string, unknown> = {
      id_imagen_r2: idImagenR2,
      pipeline: this.pipeline.pipeline(),
      depth_model: this.pipeline.depthModel(),
    };
    // FOV elegido en Configuración; si es «Automático» no se envía y el pipeline usa el EXIF.
    const fovDeg = this.prefs.fovDeg();
    if (fovDeg !== null) body['fov_deg'] = fovDeg;
    // Focal del EXIF original, leída antes de recomprimir la imagen.
    if (f35Mm !== null) body['f35_mm'] = f35Mm;
    return this.http.post<FoodLogCreated>(`${this.api}/food-logs/`, body);
  }

  /**
   * Orquesta los 3 pasos en secuencia y emite el estado para la UI.
   *
   * El `timeout` evita que la pantalla de "analizando" se quede colgada para siempre si una
   * petición nunca responde (red móvil que se corta, proxy que no cierra…).
   */
  analyze(blob: Blob, f35Mm: number | null = null): Observable<AnalyzeEvent> {
    return this.presign(blob.type || 'image/jpeg').pipe(
      switchMap((p) =>
        concat(
          of<AnalyzeEvent>({ step: 'upload', progress: 0 }),
          this.uploadToR2(p, blob).pipe(map((progress): AnalyzeEvent => ({ step: 'upload', progress }))),
          of<AnalyzeEvent>({ step: 'infer' }),
          this.create(p.id_imagen_r2, f35Mm).pipe(
            map((result): AnalyzeEvent => ({ step: 'done', result })),
          ),
        ),
      ),
      startWith<AnalyzeEvent>({ step: 'presign' }),
      timeout(180_000),
    );
  }

  list(page = 1): Observable<Page<FoodLog>> {
    this.historyLoading.set(true);
    return this.http
      .get<Page<FoodLog>>(`${this.api}/food-logs/`, { params: new HttpParams().set('page', page) })
      .pipe(
        tap((res) => {
          this.historyPage = Math.max(this.historyPage, page);
          this.historyHasMore.set(!!res.next);
          if (page === 1) {
            this.cachedHistory.set(res.results);
          } else {
            this.cachedHistory.update((cur) => {
              const seen = new Set(cur.map((item) => item.id));
              return [...cur, ...res.results.filter((item) => !seen.has(item.id))];
            });
          }
        }),
        finalize(() => this.historyLoading.set(false)),
      );
  }

  /** Vuelve a pedir la primera página (refresco o reintento). */
  refreshHistory(): Observable<Page<FoodLog>> {
    return this.list(1);
  }

  /**
   * Carga la siguiente página del historial si queda alguna. Devuelve `null` si ya no hay
   * más o si hay una petición en curso (Historial y galería comparten estado).
   */
  loadMoreHistory(): Observable<Page<FoodLog>> | null {
    if (this.historyLoading() || !this.historyHasMore()) return null;
    return this.list(this.historyPage + 1);
  }

  /** Detalle de un análisis guardado (con los alimentos y su tabla nutricional). */
  get(id: number): Observable<FoodLogDetail> {
    const cached = this.detailCache.get(id);
    if (cached) return of(cached);
    return this.http
      .get<FoodLogDetail>(`${this.api}/food-logs/${id}/`)
      .pipe(tap((detail) => this.detailCache.set(id, detail)));
  }

  /** Corrección del usuario: alimento y/o gramos de un item, o el diámetro del plato. */
  update(
    id: number,
    body: { items?: { index: number; idx?: number; peso_g?: number }[]; plate_diameter_cm?: number },
  ): Observable<FoodLogCreated> {
    return this.http.patch<FoodLogCreated>(`${this.api}/food-logs/${id}/`, body).pipe(
      tap((updated) => {
        this.detailCache.set(id, updated);
        this.cachedHistory.update((cur) => cur.map((item) => (item.id === id ? { ...item, ...updated } : item)));
      }),
    );
  }

  /** Borra un análisis y su imagen. */
  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api}/food-logs/${id}/`).pipe(
      tap(() => {
        this.detailCache.delete(id);
        this.cachedHistory.update((cur) => cur.filter((item) => item.id !== id));
      }),
    );
  }

  /** Busca en el catálogo de 323 clases para cambiar un alimento mal clasificado. */
  searchFoods(query: string): Observable<{ resultados: CatalogFood[] }> {
    return this.http.get<{ resultados: CatalogFood[] }>(`${this.api}/foods/`, {
      params: new HttpParams().set('q', query).set('limit', '12'),
    });
  }
}

