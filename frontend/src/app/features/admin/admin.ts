import { Component, inject, signal } from '@angular/core';
import { PipelineService } from '../../core/food-log/pipeline.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

/** Ajustes reservados a administradores (`is_staff`). */
@Component({
  selector: 'app-admin',
  template: `
    <section class="page">
      <h1>{{ i18n.t('settings.adminTitle') }}</h1>
      <p class="muted">{{ i18n.t('settings.adminSubtitle') }}</p>

      <div class="card">
        <h2>{{ i18n.t('settings.pipeline') }}</h2>
        <p class="muted small">{{ i18n.t('settings.pipelineHint') }}</p>

        <div class="options" role="radiogroup" [attr.aria-label]="i18n.t('settings.pipeline')">
          @for (opt of options; track opt.id) {
            <label class="option" [class.selected]="pipeline() === opt.id">
              <input
                type="radio"
                name="pipeline"
                [value]="opt.id"
                [checked]="pipeline() === opt.id"
                (change)="select(opt.id)"
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
          [disabled]="isDefault()"
          (click)="reset()"
        >
          {{ i18n.t('settings.pipelineReset') }}
        </button>

        @if (saved()) {
          <p class="note" role="status">{{ i18n.t('settings.pipelineSaved') }}</p>
        }
      </div>
    </section>
  `,
  styleUrl: './admin.scss',
})
export class Admin {
  private readonly pipelines = inject(PipelineService);
  protected readonly i18n = inject(I18nService);
  protected readonly pipeline = this.pipelines.pipeline;
  protected readonly isDefault = this.pipelines.isDefault;
  protected readonly saved = signal(false);

  protected readonly options: { id: 'A' | 'B'; nameKey: MessageKey; detailKey: MessageKey }[] = [
    { id: 'A', nameKey: 'settings.pipelineA', detailKey: 'settings.pipelineADetail' },
    { id: 'B', nameKey: 'settings.pipelineB', detailKey: 'settings.pipelineBDetail' },
  ];

  protected select(id: 'A' | 'B'): void {
    this.pipelines.set(id);
    this.saved.set(true);
  }

  protected reset(): void {
    this.pipelines.reset();
    this.saved.set(false);
  }
}
