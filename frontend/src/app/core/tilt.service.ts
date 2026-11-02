import { Injectable, computed, signal } from '@angular/core';

/** Estado del permiso del sensor de orientación. */
export type TiltPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

/**
 * Inclinación a partir de la cual el resultado avisa de que la foto no era cenital.
 * Lo calcula el pipeline sobre la foto ya tomada (no el sensor), así que puede ser mayor
 * que el umbral del nivel en vivo: aquí solo se advierte, no se bloquea nada.
 */
export const TILT_WARN_DEG = 15;

export interface BubbleOffset {
  /** Desplazamiento de la burbuja en grados, eje X de la pantalla (derecha +). */
  x: number;
  /** Desplazamiento en grados, eje Y de la pantalla (abajo +, como en CSS). */
  y: number;
}

const SMOOTHING = 0.25;
const SILENCE_MS = 1500;

interface OrientationPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/** Ángulo entre la normal de la pantalla y la vertical del mundo, en grados. */
export function tiltDegrees(betaDeg: number, gammaDeg: number): number {
  const beta = (betaDeg * Math.PI) / 180;
  const gamma = (gammaDeg * Math.PI) / 180;
  const cos = Math.cos(beta) * Math.cos(gamma);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

function screenAngleDeg(): number {
  const orientation = screen.orientation as ScreenOrientation | undefined;
  if (orientation && typeof orientation.angle === 'number') return orientation.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}

/**
 * Posición de la burbuja en ejes de pantalla. La burbuja sube hacia el lado alto:
 * con `beta > 0` el borde superior está levantado, con `gamma > 0` el derecho está bajo.
 */
export function bubbleOffset(betaDeg: number, gammaDeg: number): BubbleOffset {
  const rad = (screenAngleDeg() * Math.PI) / 180;
  const x = -gammaDeg;
  const y = -betaDeg;
  return {
    x: x * Math.cos(rad) - y * Math.sin(rad),
    y: x * Math.sin(rad) + y * Math.cos(rad),
  };
}

/**
 * Nivel de burbuja basado en `DeviceOrientationEvent`.
 *
 * `tilt()` vale 0 cuando el móvil está plano boca arriba, que es justo la postura en la
 * que la cámara trasera mira perpendicular a la mesa (lo que asume el cálculo de volumen).
 *
 * Requiere contexto seguro (HTTPS o localhost) y, en iOS 13+, un permiso que sólo se
 * puede pedir dentro de un gesto del usuario: por eso `enable()` se llama desde un click.
 */
@Injectable({ providedIn: 'root' })
export class TiltService {
  readonly tilt = signal<number | null>(null);
  readonly beta = signal<number | null>(null);
  readonly gamma = signal<number | null>(null);
  readonly bubble = signal<BubbleOffset>({ x: 0, y: 0 });
  readonly permission = signal<TiltPermission>('unknown');
  /** El permiso está dado pero no llega ningún dato: el dispositivo no tiene sensor. */
  readonly silent = signal(false);
  readonly available = computed(() => this.tilt() !== null);

  private listening = false;
  private smoothBeta: number | null = null;
  private smoothGamma: number | null = null;
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private lastEmit = 0;

  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;

    // Los sensores emiten a 60 Hz; 20 Hz bastan para el indicador y evitan 60 ciclos
    // de detección de cambios por segundo en un móvil modesto.
    const now = performance.now();
    if (now - this.lastEmit < 50) return;
    this.lastEmit = now;

    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silent.set(false);

    this.smoothBeta = this.smoothBeta === null ? e.beta : this.smoothBeta + SMOOTHING * (e.beta - this.smoothBeta);
    this.smoothGamma =
      this.smoothGamma === null ? e.gamma : this.smoothGamma + SMOOTHING * (e.gamma - this.smoothGamma);

    this.beta.set(this.smoothBeta);
    this.gamma.set(this.smoothGamma);
    this.tilt.set(tiltDegrees(this.smoothBeta, this.smoothGamma));
    this.bubble.set(bubbleOffset(this.smoothBeta, this.smoothGamma));
  };

  /** Pide permiso (iOS) y empieza a escuchar. Devuelve si hay sensor utilizable. */
  async enable(): Promise<boolean> {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      this.permission.set('unsupported');
      return false;
    }

    const ctor = window.DeviceOrientationEvent as unknown as OrientationPermission;
    if (typeof ctor.requestPermission === 'function') {
      try {
        if ((await ctor.requestPermission()) !== 'granted') {
          this.permission.set('denied');
          return false;
        }
      } catch {
        this.permission.set('denied');
        return false;
      }
    }

    this.permission.set('granted');
    this.listen();
    return true;
  }

  disable(): void {
    if (this.listening) {
      window.removeEventListener('deviceorientation', this.onOrientation);
      this.listening = false;
    }
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = undefined;
    this.smoothBeta = this.smoothGamma = null;
    this.tilt.set(null);
    this.beta.set(null);
    this.gamma.set(null);
    this.bubble.set({ x: 0, y: 0 });
    this.silent.set(false);
  }

  private listen(): void {
    if (!this.listening) {
      window.addEventListener('deviceorientation', this.onOrientation);
      this.listening = true;
    }
    // Si en 1,5 s no ha llegado nada, el dispositivo no tiene giroscopio (típico en desktop).
    this.silenceTimer = setTimeout(() => {
      if (this.tilt() === null) this.silent.set(true);
    }, SILENCE_MS);
  }
}
