import { Injectable, effect, inject } from '@angular/core';
import { AuthService } from './auth/auth.service';
import { I18nService } from './i18n/i18n.service';
import { PreferencesService } from './preferences.service';

/**
 * Mantiene idioma, tema y acento sincronizados con el perfil del usuario.
 *
 * - Al cargar el perfil, sus valores se aplican en este dispositivo (el servidor manda).
 * - Cada cambio local se sube al perfil con un pequeño retardo, para agrupar varios cambios.
 *
 * `lastSynced` evita el bucle: aplicar lo que viene del servidor no vuelve a disparar una subida.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesSync {
  private readonly auth = inject(AuthService);
  private readonly i18n = inject(I18nService);
  private readonly prefs = inject(PreferencesService);

  private lastSynced = '';
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    effect(() => {
      const profile = this.auth.profile();
      if (!profile) return;

      const remote = { locale: profile.locale, theme: profile.theme, accent: profile.accent };
      const key = JSON.stringify(remote);
      if (key === this.lastSynced) return;

      this.lastSynced = key;
      this.i18n.setLocale(remote.locale);
      this.prefs.setTheme(remote.theme);
      this.prefs.setAccent(remote.accent);
    });

    effect(() => {
      const local = {
        locale: this.i18n.locale(),
        theme: this.prefs.theme(),
        accent: this.prefs.accent(),
      };
      const key = JSON.stringify(local);
      if (!this.auth.profile() || key === this.lastSynced) return;

      this.lastSynced = key;
      clearTimeout(this.timer);
      // 600 ms: si el usuario toca tema y acento seguidos, se manda una sola petición.
      this.timer = setTimeout(() => {
        this.auth.savePreferences(local).subscribe({ error: () => undefined });
      }, 600);
    });
  }
}
