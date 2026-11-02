import { Injectable, NgZone, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

/** Cierre de sesión por inactividad. */
export const IDLE_TIMEOUT_MS = 30 * 60_000;
/** Aviso con margen para poder seguir conectado sin perder nada. */
export const IDLE_WARNING_MS = 60_000;

// Cualquier gesto cuenta como actividad. `pointermove` se limita para no reprogramar el
// temporizador en cada píxel.
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
const THROTTLE_MS = 1000;

/**
 * Cierra la sesión tras un rato sin actividad y avisa un minuto antes.
 *
 * No se apoya en la caducidad del JWT a propósito: el refresh dura 14 días, así que un móvil
 * olvidado en una mesa seguiría con la sesión abierta.
 */
@Injectable({ providedIn: 'root' })
export class IdleService {
  private readonly auth = inject(AuthService);
  private readonly zone = inject(NgZone);

  private timer?: ReturnType<typeof setTimeout>;
  private warnTimer?: ReturnType<typeof setTimeout>;
  private lastReset = 0;
  private listening = false;

  /** `true` cuando queda menos de un minuto para el cierre automático. */
  readonly warning = signal(false);

  /** Arranca la vigilancia (idempotente). Se llama cuando hay sesión. */
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

  /** Detiene los temporizadores (al cerrar sesión). Los listeners se quedan, son baratos. */
  stop(): void {
    this.clearTimers();
    this.warning.set(false);
    this.lastReset = 0;
  }

  /** «Seguir conectado»: reinicia la cuenta atrás y quita el aviso. */
  keepAlive(): void {
    this.reset(true);
  }

  private readonly onActivity = (): void => this.reset();

  private readonly onVisibility = (): void => {
    // Volver a la pestaña cuenta como actividad; con la pestaña oculta los temporizadores
    // siguen corriendo, que es justo lo que se quiere medir.
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
