import { Component, computed, input } from '@angular/core';
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
          <span>sin sensor</span>
        } @else {
          <strong>{{ tilt()!.toFixed(0) }}°</strong>
          <span>{{ status() === 'ok' ? 'cenital' : 'de la vertical' }}</span>
        }
      </div>
    </div>

    <p class="hint" aria-live="polite">{{ hint() }}</p>
  `,
  styleUrl: './level-gauge.scss',
})
export class LevelGauge {
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
    if (value === null) return 'Sin sensor de inclinación: mantén el móvil paralelo a la mesa.';
    if (this.level()) return '¡Perfecto! Mantén así un instante.';

    const beta = this.beta() ?? 0;
    const gamma = this.gamma() ?? 0;
    // Se corrige primero el eje más desviado, para no dar dos instrucciones a la vez.
    if (Math.abs(beta) >= Math.abs(gamma)) {
      return beta > 0 ? 'Levanta el borde inferior' : 'Levanta el borde superior';
    }
    return gamma > 0 ? 'Levanta el borde derecho' : 'Levanta el borde izquierdo';
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
