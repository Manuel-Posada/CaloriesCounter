import { Injectable, computed, signal } from '@angular/core';

/**
 * Inference pipeline sent to the backend.
 * B = class-agnostic Mask2Former + Inception-V4 (323 classes), used in production.
 * A = YOLO26-seg, kept available for comparison.
 */
export const PRODUCTION_PIPELINE: Pipeline = 'B';
export type Pipeline = 'A' | 'B';

/**
 * Metric depth model variant (Depth Anything V2).
 * small = 24.8M parameters, validated in production and lightweight.
 * large = 335.3M parameters, finer relief detail with calibration.
 */
export const PRODUCTION_DEPTH_MODEL: DepthModel = 'small';
export type DepthModel = 'small' | 'large';

const PIPELINE_STORAGE_KEY = 'cc.pipeline';
const DEPTH_STORAGE_KEY = 'cc.depth_model';

/**
 * Local inference preferences (pipeline and depth model).
 * Only changed via the admin panel, and only affect this device:
 * the backend and Modal accept these parameters per request with no global state.
 */
@Injectable({ providedIn: 'root' })
export class PipelineService {
  readonly pipeline = signal<Pipeline>(readStoredPipeline());
  readonly depthModel = signal<DepthModel>(readStoredDepthModel());

  /** `true` when using the production pipeline (B) with no override. */
  readonly isDefault = computed(() => this.pipeline() === PRODUCTION_PIPELINE);
  /** `true` when using the production depth variant (small) with no override. */
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
