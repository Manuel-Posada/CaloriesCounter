import { environment } from '../../environments/environment';

/**
 * Despierta el backend antes de que haga falta.
 *
 * Render (plan free) duerme el servicio a los 15 min sin tráfico y el siguiente request
 * tarda 30-50 s en responder. Lanzar `GET /health` al abrir la app hace que ese arranque
 * ocurra mientras el usuario todavía está en la pantalla de captura, no al pulsar analizar.
 *
 * Es "fire and forget": si falla, no importa (el flujo real volverá a intentarlo).
 */
export function warmUpApi(): void {
  const base = environment.apiUrl.replace(/\/api\/?$/, '');
  void fetch(`${base}/health`, { cache: 'no-store' }).catch(() => undefined);
}
