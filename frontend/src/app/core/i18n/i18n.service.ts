import { Injectable, computed, effect, signal } from '@angular/core';
import { EN, ES, MessageKey } from './messages';

export type Locale = 'es' | 'en';

const STORAGE_KEY = 'cc.locale';

/**
 * Idioma de la interfaz, con cambio en caliente.
 *
 * `t()` lee la señal `locale`, así que cualquier plantilla que lo llame se reevalúa sola al
 * cambiar de idioma. El valor por defecto sale de `navigator.language` (la señal estándar:
 * instantánea, sin red y sin fallar detrás de VPN) y luego se recuerda en el dispositivo.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly locale = signal<Locale>(initialLocale());

  /** Locale que esperan `DatePipe` / `DecimalPipe` (es | en-US). */
  readonly dateLocale = computed(() => (this.locale() === 'es' ? 'es' : 'en-US'));

  /** Formatos de fecha con el orden natural de cada idioma. */
  readonly shortDate = computed(() => (this.locale() === 'es' ? 'd MMM, HH:mm' : 'MMM d, HH:mm'));
  readonly longDate = computed(() => (this.locale() === 'es' ? 'EEEE d MMM, HH:mm' : 'EEEE, MMM d, HH:mm'));

  constructor() {
    // Mantiene <html lang> sincronizado: lectores de pantalla, guiones y corrector.
    effect(() => {
      document.documentElement.lang = this.locale();
    });
  }

  t(key: MessageKey, params?: Record<string, string | number>): string {
    let text: string = (this.locale() === 'es' ? ES : EN)[key];
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  }

  setLocale(locale: Locale): void {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* modo privado: vale para esta sesión */
    }
    this.locale.set(locale);
  }
}

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'es' || stored === 'en') return stored;
  } catch {
    /* sin acceso a localStorage */
  }
  return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
}
