import { HttpClient, HttpEventType, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, concat, filter, map, of, startWith, switchMap, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FoodLog, FoodLogCreated, Page, PresignResponse } from '../models';
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
    const body: Record<string, unknown> = { id_imagen_r2: idImagenR2, pipeline: this.pipeline.pipeline() };
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
    return this.http.get<Page<FoodLog>>(`${this.api}/food-logs/`, { params: new HttpParams().set('page', page) });
  }
}

