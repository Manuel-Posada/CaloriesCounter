import { Injectable, computed, effect, signal } from '@angular/core';
import { EN, ES, MessageKey } from './messages';

export type Locale = 'es' | 'en';

const STORAGE_KEY = 'cc.locale';

/**
 * UI language with live hot-switching.
 *
 * `t()` reads the `locale` signal, so any template calling it re-evaluates automatically on
 * language change. The default comes from `navigator.language` (standard signal: instant,
 * offline, and reliable behind a VPN) and is then remembered on the device.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly locale = signal<Locale>(initialLocale());

  /** Locale expected by `DatePipe` / `DecimalPipe` (es | en-US). */
  readonly dateLocale = computed(() => (this.locale() === 'es' ? 'es' : 'en-US'));

  /** Date formats in each language's natural order. */
  readonly shortDate = computed(() => (this.locale() === 'es' ? 'd MMM y, HH:mm' : 'MMM d, y, HH:mm'));
  readonly longDate = computed(() =>
    this.locale() === 'es' ? 'EEEE d MMM y, HH:mm' : 'EEEE, MMM d, y, HH:mm',
  );

  constructor() {
    // Keeps <html lang> synchronized: screen readers, hyphenation, and spellcheck.
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
      /* private mode: applies for this session only */
    }
    this.locale.set(locale);
  }
}

function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'es' || stored === 'en') return stored;
  } catch {
    /* no localStorage access */
  }
  return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
}
