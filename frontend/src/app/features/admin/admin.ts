import { Component, inject, signal } from '@angular/core';
import { DepthModel, Pipeline, PipelineService } from '../../core/food-log/pipeline.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

/** Ajustes de inferencia reservados a administradores (`is_staff`). */
@Component({
  selector: 'app-admin',
  template: `
    <section class="page">
      <h1>{{ i18n.t('settings.adminTitle') }}</h1>
      <p class="muted">{{ i18n.t('settings.adminSubtitle') }}</p>

      <!-- Selector de Pipeline (A / B) -->
      <div class="card">
        <h2>{{ i18n.t('settings.pipeline') }}</h2>
        <p class="muted small">{{ i18n.t('settings.pipelineHint') }}</p>

        <div class="options" role="radiogroup" [attr.aria-label]="i18n.t('settings.pipeline')">
          @for (opt of pipelineOptions; track opt.id) {
            <label class="option" [class.selected]="pipeline() === opt.id">
              <input
                type="radio"
                name="pipeline"
                [value]="opt.id"
                [checked]="pipeline() === opt.id"
                (change)="selectPipeline(opt.id)"
              />
              <span class="text">
                <strong>{{ opt.id }} · {{ i18n.t(opt.nameKey) }}</strong>
                <small>{{ i18n.t(opt.detailKey) }}</small>
              </span>
            </label>
          }
        </div>

        <button
          type="button"
          class="btn btn--ghost btn--block"
          [disabled]="isDefaultPipeline()"
          (click)="resetPipeline()"
        >
          {{ i18n.t('settings.pipelineReset') }}
        </button>

        @if (savedPipeline()) {
          <p class="note" role="status">{{ i18n.t('settings.pipelineSaved') }}</p>
        }
      </div>

      <!-- Selector de Modelo de Profundidad (Small / Large) -->
      <div class="card" style="margin-top: var(--space-4);">
        <h2>{{ i18n.t('settings.depthModel') }}</h2>
        <p class="muted small">{{ i18n.t('settings.depthModelHint') }}</p>

        <div class="options" role="radiogroup" [attr.aria-label]="i18n.t('settings.depthModel')">
          @for (opt of depthOptions; track opt.id) {
            <label class="option" [class.selected]="depthModel() === opt.id">
              <input
                type="radio"
                name="depthModel"
                [value]="opt.id"
                [checked]="depthModel() === opt.id"
                (change)="selectDepth(opt.id)"
              />
              <span class="text">
                <strong>{{ i18n.t(opt.nameKey) }}</strong>
                <small>{{ i18n.t(opt.detailKey) }}</small>
              </span>
            </label>
          }
        </div>

        <button
          type="button"
          class="btn btn--ghost btn--block"
          [disabled]="isDefaultDepth()"
          (click)="resetDepth()"
        >
          {{ i18n.t('settings.depthReset') }}
        </button>

        @if (savedDepth()) {
          <p class="note" role="status">{{ i18n.t('settings.depthSaved') }}</p>
        }
      </div>
    </section>
  `,
  styleUrl: './admin.scss',
})
export class Admin {
  private readonly pipelines = inject(PipelineService);
  protected readonly i18n = inject(I18nService);

  // Pipeline state
  protected readonly pipeline = this.pipelines.pipeline;
  protected readonly isDefaultPipeline = this.pipelines.isDefault;
  protected readonly savedPipeline = signal(false);

  // Depth model state
  protected readonly depthModel = this.pipelines.depthModel;
  protected readonly isDefaultDepth = this.pipelines.isDefaultDepth;
  protected readonly savedDepth = signal(false);

  protected readonly pipelineOptions: { id: Pipeline; nameKey: MessageKey; detailKey: MessageKey }[] = [
    { id: 'A', nameKey: 'settings.pipelineA', detailKey: 'settings.pipelineADetail' },
    { id: 'B', nameKey: 'settings.pipelineB', detailKey: 'settings.pipelineBDetail' },
  ];

  protected readonly depthOptions: { id: DepthModel; nameKey: MessageKey; detailKey: MessageKey }[] = [
    { id: 'small', nameKey: 'settings.depthSmall', detailKey: 'settings.depthSmallDetail' },
    { id: 'large', nameKey: 'settings.depthLarge', detailKey: 'settings.depthLargeDetail' },
  ];

  protected selectPipeline(id: Pipeline): void {
    this.pipelines.set(id);
    this.savedPipeline.set(true);
    setTimeout(() => this.savedPipeline.set(false), 3000);
  }

  protected resetPipeline(): void {
    this.pipelines.reset();
    this.savedPipeline.set(false);
  }

  protected selectDepth(id: DepthModel): void {
    this.pipelines.setDepth(id);
    this.savedDepth.set(true);
    setTimeout(() => this.savedDepth.set(false), 3000);
  }

  protected resetDepth(): void {
    this.pipelines.resetDepth();
    this.savedDepth.set(false);
  }
}
