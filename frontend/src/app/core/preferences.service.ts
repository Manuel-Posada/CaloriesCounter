import { Injectable, computed, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';
export type Accent = 'green' | 'blue' | 'orange' | 'pink' | 'violet';
export type LevelSensitivity = 'strict' | 'normal' | 'relaxed';

export const ACCENTS: readonly Accent[] = ['green', 'blue', 'orange', 'pink', 'violet'];
export const FOV_OPTIONS: readonly (number | null)[] = [null, 60, 65, 70, 75, 80];

/** Umbrales del nivel de burbuja (verde / se pierde) por sensibilidad. */
const LEVEL_THRESHOLDS: Record<LevelSensitivity, { enter: number; exit: number }> = {
  strict: { enter: 5, exit: 8 },
  normal: { enter: 8, exit: 12 },
  relaxed: { enter: 12, exit: 16 },
};

const KEYS = {
  theme: 'cc.theme',
  accent: 'cc.accent',
  level: 'cc.level',
  fov: 'cc.fov',
  autoShoot: 'cc.autoshoot',
} as const;

/**
 * Preferencias del usuario que se aplican en el cliente: tema, acento y ajustes de cámara.
 * Se guardan en `localStorage` (por dispositivo) y no pasan por el servidor.
 */
@Injectable({ providedIn: 'root' })
export class PreferencesService {
  readonly theme = signal<ThemeMode>(oneOf(KEYS.theme, ['system', 'light', 'dark'], 'system'));
  readonly accent = signal<Accent>(oneOf(KEYS.accent, ACCENTS, 'green'));
  readonly level = signal<LevelSensitivity>(oneOf(KEYS.level, ['strict', 'normal', 'relaxed'], 'normal'));
  /** FOV horizontal de la cámara en grados; `null` = que decida el pipeline (EXIF o 65°). */
  readonly fovDeg = signal<number | null>(readFov());

  /** Disparo automático al mantenerse nivelado (por defecto, manual). */
  readonly autoShoot = signal<boolean>(readBool(KEYS.autoShoot, false));

  /** Ángulo a partir del cual el aro se pone verde. */
  readonly levelEnter = computed(() => LEVEL_THRESHOLDS[this.level()].enter);
  /** Histéresis: una vez verde no se pierde hasta superar este ángulo. */
  readonly levelExit = computed(() => LEVEL_THRESHOLDS[this.level()].exit);

  private readonly darkMedia = window.matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    // El tema se aplica solo (el efecto lee `theme` y `accent`).
    effect(() => this.applyTheme());
    this.darkMedia.addEventListener('change', () => this.applyTheme());
  }

  setTheme(mode: ThemeMode): void {
    this.theme.set(mode);
    save(KEYS.theme, mode);
  }

  setAccent(accent: Accent): void {
    this.accent.set(accent);
    save(KEYS.accent, accent);
  }

  setLevel(level: LevelSensitivity): void {
    this.level.set(level);
    save(KEYS.level, level);
  }

  setFov(fov: number | null): void {
    this.fovDeg.set(fov);
    if (fov === null) remove(KEYS.fov);
    else save(KEYS.fov, String(fov));
  }

  setAutoShoot(enabled: boolean): void {
    this.autoShoot.set(enabled);
    save(KEYS.autoShoot, enabled ? '1' : '0');
  }

  private applyTheme(): void {
    const mode = this.theme();
    const dark = mode === 'dark' || (mode === 'system' && this.darkMedia.matches);
    const root = document.documentElement;
    root.dataset['theme'] = dark ? 'dark' : 'light';

    const accent = this.accent();
    if (accent === 'green') delete root.dataset['accent'];
    else root.dataset['accent'] = accent;
  }
}

function oneOf<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
  } catch {
    return fallback;
  }
}

function readFov(): number | null {
  try {
    const stored = Number(localStorage.getItem(KEYS.fov));
    return FOV_OPTIONS.includes(stored) && stored !== 0 ? stored : null;
  } catch {
    return null;
  }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === '1' || stored === 'true';
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* modo privado: el cambio vale para esta sesión */
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nada que hacer */
  }
}
