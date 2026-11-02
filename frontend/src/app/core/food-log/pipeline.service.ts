import { Injectable, computed, signal } from '@angular/core';

/**
 * Pipeline de inferencia que se envía al backend.
 * B = Mask2Former agnóstico + Inception-V4 (323 clases), el de producción.
 * A = YOLO26-seg, se mantiene disponible para comparar.
 */
export const PRODUCTION_PIPELINE: Pipeline = 'B';

export type Pipeline = 'A' | 'B';

const STORAGE_KEY = 'cc.pipeline';

/**
 * Preferencia local del pipeline. Solo la cambia el panel de administración, y solo afecta
 * a este dispositivo: el backend acepta `pipeline` en cada POST, así que no hay estado global.
 */
@Injectable({ providedIn: 'root' })
export class PipelineService {
  readonly pipeline = signal<Pipeline>(readStored());
  /** `true` cuando se usa el de producción (B) sin override. */
  readonly isDefault = computed(() => this.pipeline() === PRODUCTION_PIPELINE);

  set(pipeline: Pipeline): void {
    localStorage.setItem(STORAGE_KEY, pipeline);
    this.pipeline.set(pipeline);
  }

  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.pipeline.set(PRODUCTION_PIPELINE);
  }
}

function readStored(): Pipeline {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'A' || stored === 'B' ? stored : PRODUCTION_PIPELINE;
  } catch {
    // localStorage puede no estar disponible (modo privado, políticas del navegador).
    return PRODUCTION_PIPELINE;
  }
}
