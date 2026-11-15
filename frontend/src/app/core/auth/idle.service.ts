import { Injectable, NgZone, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

/** Idle session timeout. */
export const IDLE_TIMEOUT_MS = 30 * 60_000;
/** Warning lead time so the user can stay signed in without losing anything. */
export const IDLE_WARNING_MS = 60_000;

// Any gesture counts as activity. `pointermove` is throttled to avoid rescheduling the
// timer on every pixel.
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
const THROTTLE_MS = 1000;

/**
 * Logs out after a period of inactivity and warns one minute beforehand.
 *
 * Intentionally does not rely on JWT expiration: the refresh token lasts 14 days, so a phone
 * left on a table would otherwise stay signed in.
 */
@Injectable({ providedIn: 'root' })
export class IdleService {
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  private timer?: ReturnType<typeof setTimeout>;
  private warnTimer?: ReturnType<typeof setTimeout>;
  private lastReset = 0;
  private listening = false;

  /** `true` when less than a minute remains before automatic logout. */
  readonly warning = signal(false);

  /** Starts watching (idempotent). Called when a session is active. */
  start(): void {
    if (!this.listening) {
      this.listening = true;
      for (const event of ACTIVITY_EVENTS) {
        window.addEventListener(event, this.onActivity, { passive: true });
      }
      document.addEventListener('visibilitychange', this.onVisibility);
    }
    this.reset(true);
  }

  /** Stops timers (on logout). Event listeners remain attached as they are cheap. */
  stop(): void {
    this.clearTimers();
    this.warning.set(false);
    this.lastReset = 0;
  }

  /** "Stay signed in": resets the countdown and dismisses the warning. */
  keepAlive(): void {
    this.reset(true);
  }

  private readonly onActivity = (): void => this.reset();

  private readonly onVisibility = (): void => {
    // Returning to the tab counts as activity; while the tab is hidden, timers keep
    // running, which is exactly what we want to measure.
    if (!document.hidden) this.reset();
  };

  private reset(force = false): void {
    if (!this.auth.isAuthenticated()) {
      this.stop();
      return;
    }
    const now = Date.now();
    if (!force && now - this.lastReset < THROTTLE_MS) return;
    this.lastReset = now;
    this.warning.set(false);
    this.clearTimers();

    this.warnTimer = setTimeout(
      () => this.zone.run(() => this.showWarning()),
      IDLE_TIMEOUT_MS - IDLE_WARNING_MS,
    );
    this.timer = setTimeout(() => this.zone.run(() => this.expire()), IDLE_TIMEOUT_MS);
  }

  private showWarning(): void {
    if (!this.auth.isAuthenticated()) return;
    this.warning.set(true);
  }

  private expire(): void {
    this.warning.set(false);
    this.clearTimers();
    if (this.auth.isAuthenticated()) this.auth.logout('idle');
  }

  private clearTimers(): void {
    if (this.warnTimer !== undefined) clearTimeout(this.warnTimer);
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.warnTimer = undefined;
    this.timer = undefined;
  }
}
