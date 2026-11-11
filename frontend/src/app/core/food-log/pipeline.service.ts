import { Injectable, computed, signal } from '@angular/core';

/**
 * Pipeline de inferencia que se envía al backend.
 * B = Mask2Former agnóstico + Inception-V4 (323 clases), el de producción.
 * A = YOLO26-seg, se mantiene disponible para comparar.
 */
export const PRODUCTION_PIPELINE: Pipeline = 'B';
export type Pipeline = 'A' | 'B';

/**
 * Variante del modelo de profundidad métrico (Depth Anything V2).
 * small = 24.8M parámetros, validado en producción y ligero.
 * large = 335.3M parámetros, mayor detalle de relieve con calibración.
 */
export const PRODUCTION_DEPTH_MODEL: DepthModel = 'small';
export type DepthModel = 'small' | 'large';

const PIPELINE_STORAGE_KEY = 'cc.pipeline';
const DEPTH_STORAGE_KEY = 'cc.depth_model';

/**
 * Preferencias locales de inferencia (pipeline y modelo de profundidad).
 * Solo las cambia el panel de administración, y solo afectan a este dispositivo:
 * el backend y Modal aceptan estos parámetros por petición sin estado global.
 */
@Injectable({ providedIn: 'root' })
export class PipelineService {
  readonly pipeline = signal<Pipeline>(readStoredPipeline());
  readonly depthModel = signal<DepthModel>(readStoredDepthModel());

  /** `true` cuando se usa el pipeline de producción (B) sin override. */
  readonly isDefault = computed(() => this.pipeline() === PRODUCTION_PIPELINE);
  /** `true` cuando se usa la variante de profundidad de producción (small) sin override. */
  readonly isDefaultDepth = computed(() => this.depthModel() === PRODUCTION_DEPTH_MODEL);

  set(pipeline: Pipeline): void {
    localStorage.setItem(PIPELINE_STORAGE_KEY, pipeline);
    this.pipeline.set(pipeline);
  }

  setDepth(depthModel: DepthModel): void {
    localStorage.setItem(DEPTH_STORAGE_KEY, depthModel);
    this.depthModel.set(depthModel);
  }

  reset(): void {
    localStorage.removeItem(PIPELINE_STORAGE_KEY);
    this.pipeline.set(PRODUCTION_PIPELINE);
  }

  resetDepth(): void {
    localStorage.removeItem(DEPTH_STORAGE_KEY);
    this.depthModel.set(PRODUCTION_DEPTH_MODEL);
  }
}

function readStoredPipeline(): Pipeline {
  try {
    const stored = localStorage.getItem(PIPELINE_STORAGE_KEY);
    return stored === 'A' || stored === 'B' ? stored : PRODUCTION_PIPELINE;
  } catch {
    return PRODUCTION_PIPELINE;
  }
}

function readStoredDepthModel(): DepthModel {
  try {
    const stored = localStorage.getItem(DEPTH_STORAGE_KEY);
    return stored === 'small' || stored === 'large' ? stored : PRODUCTION_DEPTH_MODEL;
  } catch {
    return PRODUCTION_DEPTH_MODEL;
  }
}
