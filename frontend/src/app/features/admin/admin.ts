import { Component, inject, signal } from '@angular/core';
import { PipelineService } from '../../core/food-log/pipeline.service';

/** Ajustes reservados a administradores (`is_staff`). */
@Component({
  selector: 'app-admin',
  template: `
    <section class="page">
      <h1>Administración</h1>
      <p class="muted">Ajustes de inferencia reservados a administradores.</p>

      <div class="card">
        <h2>Pipeline</h2>
        <p class="muted small">
          Se envía con cada análisis. Solo afecta a este dispositivo: el resto de usuarios sigue
          con el pipeline de producción.
        </p>

        <div class="options" role="radiogroup" aria-label="Pipeline de inferencia">
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
                <strong>{{ opt.id }} · {{ opt.name }}</strong>
                <small>{{ opt.detail }}</small>
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
          Restablecer el de producción (B)
        </button>

        @if (saved()) {
          <p class="note" role="status">Guardado en este dispositivo.</p>
        }
      </div>
    </section>
  `,
  styleUrl: './admin.scss',
})
export class Admin {
  private readonly pipelines = inject(PipelineService);
  protected readonly pipeline = this.pipelines.pipeline;
  protected readonly isDefault = this.pipelines.isDefault;
  protected readonly saved = signal(false);

  protected readonly options = [
    {
      id: 'A' as const,
      name: 'YOLO26-seg',
      detail: 'Segmenta y clasifica en una sola pasada. Más rápido, menos fino con platos complejos.',
    },
    {
      id: 'B' as const,
      name: 'Mask2Former + Inception-V4',
      detail: 'Segmentación agnóstica y clasificador de 323 clases. Es el de producción.',
    },
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
