import { Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { BubbleOffset } from '../../core/tilt.service';

type Status = 'ok' | 'near' | 'far' | 'none';

/** Radio útil del indicador en px: el aro mide 96 px y la burbuja no debe salirse. */
const RING_RADIUS = 36;
/** Grados de inclinación que llevan la burbuja al borde del aro. */
const FULL_SCALE_DEG = 25;

@Component({
  selector: 'app-level-gauge',
  template: `
    <div class="gauge" [class]="'gauge--' + status()">
      <div class="ring" aria-hidden="true">
        <div class="cross-x"></div>
        <div class="cross-y"></div>
        <div class="bubble" [style.transform]="bubbleTransform()"></div>
      </div>

      <div class="readout">
        @if (tilt() === null) {
          <strong>—</strong>
          <span>{{ i18n.t('gauge.noSensorShort') }}</span>
        } @else {
          <strong>{{ tilt()!.toFixed(0) }}°</strong>
          <span>{{ status() === 'ok' ? i18n.t('gauge.level') : i18n.t('gauge.fromVertical') }}</span>
        }
      </div>
    </div>

    <p class="hint" aria-live="polite">{{ hint() }}</p>
  `,
  styleUrl: './level-gauge.scss',
})
export class LevelGauge {
  protected readonly i18n = inject(I18nService);

  readonly tilt = input<number | null>(null);
  readonly beta = input<number | null>(null);
  readonly gamma = input<number | null>(null);
  readonly bubble = input<BubbleOffset>({ x: 0, y: 0 });
  readonly level = input(false);
  /** Ángulo hasta el que se considera "cerca" (histéresis de la sensibilidad elegida). */
  readonly exitDeg = input(12);

  protected readonly status = computed<Status>(() => {
    const value = this.tilt();
    if (value === null) return 'none';
    if (this.level()) return 'ok';
    return value <= this.exitDeg() ? 'near' : 'far';
  });

  protected readonly hint = computed(() => {
    const value = this.tilt();
    if (value === null) return this.i18n.t('gauge.noSensorHint');
    if (this.level()) return this.i18n.t('gauge.perfect');

    const beta = this.beta() ?? 0;
    const gamma = this.gamma() ?? 0;
    // Se corrige primero el eje más desviado, para no dar dos instrucciones a la vez.
    if (Math.abs(beta) >= Math.abs(gamma)) {
      return beta > 0 ? this.i18n.t('gauge.lowerBottom') : this.i18n.t('gauge.lowerTop');
    }
    return gamma > 0 ? this.i18n.t('gauge.lowerRight') : this.i18n.t('gauge.lowerLeft');
  });

  protected readonly bubbleTransform = computed(() => {
    const { x, y } = this.bubble();
    const magnitude = Math.hypot(x, y);
    const scale = Math.min(1, magnitude / FULL_SCALE_DEG);
    const angle = Math.atan2(y, x);
    const px = Math.cos(angle) * scale * RING_RADIUS;
    const py = Math.sin(angle) * scale * RING_RADIUS;
    return `translate(-50%, -50%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
  });
}
