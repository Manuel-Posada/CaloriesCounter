import { environment } from '../../environments/environment';

/**
 * Wakes up the backend before it is needed.
 *
 * Render (free plan) sleeps the service after 15 min without traffic, and the next request
 * takes 30-50 s to respond. Firing `GET /health` when opening the app lets that cold start
 * happen while the user is still on the capture screen, rather than when tapping analyze.
 *
 * Fire-and-forget: if it fails, it doesn't matter (the real flow will retry).
 */
export function warmUpApi(): void {
  const base = environment.apiUrl.replace(/\/api\/?$/, '');
  void fetch(`${base}/health`, { cache: 'no-store' }).catch(() => undefined);
}
