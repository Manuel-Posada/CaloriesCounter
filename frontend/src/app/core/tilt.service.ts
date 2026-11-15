import { Injectable, NgZone, computed, inject, signal } from '@angular/core';

/** Orientation sensor permission state. */
export type TiltPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

/**
 * Tilt threshold above which the result warns that the photo was not top-down.
 * Computed by the pipeline on the taken photo (not the sensor), so it can be higher
 * than the live level threshold: this only warns, it does not block anything.
 */
export const TILT_WARN_DEG = 15;

export interface BubbleOffset {
  /** Bubble offset in degrees, screen X axis (right +). */
  x: number;
  /** Offset in degrees, screen Y axis (down +, as in CSS). */
  y: number;
}

const SMOOTHING = 0.25;
const SILENCE_MS = 1500;

interface OrientationPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/** Angle between the screen normal and world vertical, in degrees. */
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
 * Bubble position in screen axes. The bubble rises toward the high side:
 * with `beta > 0` the top edge is raised, with `gamma > 0` the right edge is low.
 *
 * In CSS the +Y axis points down (clockwise), while `screen.orientation.angle`
 * measures physical device rotation counterclockwise (90° = landscape-primary), so
 * rotating to screen coordinates flips the sine sign.
 */
export function bubbleOffset(betaDeg: number, gammaDeg: number): BubbleOffset {
  const rad = (screenAngleDeg() * Math.PI) / 180;
  const x = -gammaDeg;
  const y = -betaDeg;
  return {
    x: x * Math.cos(rad) + y * Math.sin(rad),
    y: -x * Math.sin(rad) + y * Math.cos(rad),
  };
}

/**
 * Bubble level based on `DeviceOrientationEvent`.
 *
 * `tilt()` is 0 when the phone is flat face-up, which is the exact posture where
 * the rear camera points perpendicular to the table (as assumed by volume estimation).
 *
 * Requires a secure context (HTTPS or localhost) and, on iOS 13+, a permission that can
 * only be requested inside a user gesture: that is why `enable()` is called from a click.
 */
@Injectable({ providedIn: 'root' })
export class TiltService {
  private readonly ngZone = inject(NgZone);

  readonly tilt = signal<number | null>(null);
  readonly beta = signal<number | null>(null);
  readonly gamma = signal<number | null>(null);
  readonly bubble = signal<BubbleOffset>({ x: 0, y: 0 });
  readonly permission = signal<TiltPermission>('unknown');
  /** Permission is granted but no data arrives: the device has no sensor. */
  readonly silent = signal(false);
  readonly available = computed(() => this.tilt() !== null);

  private listening = false;
  /** Smoothed 3D normal vector to avoid Euler discontinuities (gimbal lock at ±90°). */
  private smoothNx: number | null = null;
  private smoothNy: number | null = null;
  private smoothNz: number | null = null;
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private lastEmit = 0;

  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return;

    // Sensors emit at 60 Hz; 20 Hz is enough for the indicator and avoids 60 change
    // detection cycles per second on a modest phone.
    const now = performance.now();
    if (now - this.lastEmit < 50) return;
    this.lastEmit = now;

    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }

    // Project (beta, gamma) onto the 3D unit normal of the screen before smoothing:
    // this avoids sudden Euler jumps when gamma flips between +89° and -89° vertically.
    const betaRad = (e.beta * Math.PI) / 180;
    const gammaRad = (e.gamma * Math.PI) / 180;
    const nx = -Math.cos(betaRad) * Math.sin(gammaRad);
    const ny = -Math.sin(betaRad);
    const nz = Math.cos(betaRad) * Math.cos(gammaRad);

    this.smoothNx = this.smoothNx === null ? nx : this.smoothNx + SMOOTHING * (nx - this.smoothNx);
    this.smoothNy = this.smoothNy === null ? ny : this.smoothNy + SMOOTHING * (ny - this.smoothNy);
    this.smoothNz = this.smoothNz === null ? nz : this.smoothNz + SMOOTHING * (nz - this.smoothNz);

    const len = Math.hypot(this.smoothNx, this.smoothNy, this.smoothNz) || 1;
    const ux = this.smoothNx / len;
    const uy = this.smoothNy / len;
    const uz = this.smoothNz / len;

    const smoothBeta = (Math.asin(Math.min(1, Math.max(-1, -uy))) * 180) / Math.PI;
    const smoothGamma = (Math.atan2(-ux, uz) * 180) / Math.PI;
    const tiltDeg = (Math.acos(Math.min(1, Math.max(-1, uz))) * 180) / Math.PI;

    const bubble = bubbleOffset(smoothBeta, smoothGamma);

    // Re-enter Angular zone only at 20 Hz when updating signals.
    this.ngZone.run(() => {
      this.silent.set(false);
      this.beta.set(smoothBeta);
      this.gamma.set(smoothGamma);
      this.tilt.set(tiltDeg);
      this.bubble.set(bubble);
    });
  };

  /** Requests permission (iOS) and starts listening. Returns whether a usable sensor is available. */
  async enable(): Promise<boolean> {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      this.permission.set('unsupported');
      return false;
    }

    if (this.permission() !== 'granted') {
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
    }

    this.listen();
    return true;
  }

  disable(): void {
    if (this.listening) {
      this.ngZone.runOutsideAngular(() => {
        window.removeEventListener('deviceorientation', this.onOrientation);
      });
      this.listening = false;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
    this.smoothNx = this.smoothNy = this.smoothNz = null;
    this.tilt.set(null);
    this.beta.set(null);
    this.gamma.set(null);
    this.bubble.set({ x: 0, y: 0 });
    this.silent.set(false);
  }

  private listen(): void {
    if (!this.listening) {
      this.ngZone.runOutsideAngular(() => {
        window.addEventListener('deviceorientation', this.onOrientation, { passive: true });
      });
      this.listening = true;
    }
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    // If nothing arrives within 1.5 s, the device has no gyroscope (typical on desktop).
    this.silenceTimer = this.ngZone.runOutsideAngular(() =>
      setTimeout(() => {
        if (this.tilt() === null) {
          this.ngZone.run(() => this.silent.set(true));
        }
      }, SILENCE_MS),
    );
  }
}
