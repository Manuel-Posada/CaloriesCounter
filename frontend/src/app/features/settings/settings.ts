import { Component, computed, inject } from '@angular/core';
import { I18nService, Locale } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { Accent, LevelSensitivity, PreferencesService, ThemeMode } from '../../core/preferences.service';

@Component({
  selector: 'app-settings',
  template: `
    <section class="page">
      <h1>{{ i18n.t('settings.title') }}</h1>
      <p class="muted">{{ i18n.t('settings.subtitle') }}</p>

      <!-- Apariencia -->
      <section class="card group">
        <h2>{{ i18n.t('settings.appearance') }}</h2>

        <p class="label">{{ i18n.t('settings.language') }}</p>
        <div class="segmented" role="group" [attr.aria-label]="i18n.t('settings.language')">
          @for (l of languages; track l.id) {
            <button
              type="button"
              [class.active]="i18n.locale() === l.id"
              [attr.aria-pressed]="i18n.locale() === l.id"
              (click)="i18n.setLocale(l.id)"
            >
              {{ l.label }}
            </button>
          }
        </div>
        <p class="hint">{{ i18n.t('settings.languageHint') }}</p>

        <p class="label">{{ i18n.t('settings.theme') }}</p>
        <div class="segmented" role="group" [attr.aria-label]="i18n.t('settings.theme')">
          @for (t of themes; track t.id) {
            <button
              type="button"
              [class.active]="prefs.theme() === t.id"
              [attr.aria-pressed]="prefs.theme() === t.id"
              (click)="prefs.setTheme(t.id)"
            >
              {{ i18n.t(t.key) }}
            </button>
          }
        </div>

        <p class="label">{{ i18n.t('settings.accent') }}</p>
        <div class="swatches" role="group" [attr.aria-label]="i18n.t('settings.accent')">
          @for (a of accents; track a.id) {
            <button
              type="button"
              class="swatch"
              [class.active]="prefs.accent() === a.id"
              [style]="{ '--swatch': a.color }"
              [attr.aria-label]="i18n.t(a.key)"
              [attr.aria-pressed]="prefs.accent() === a.id"
              (click)="prefs.setAccent(a.id)"
            >
              <span aria-hidden="true">✓</span>
            </button>
          }
        </div>
      </section>

      <!-- Cámara -->
      <section class="card group">
        <h2>{{ i18n.t('settings.camera') }}</h2>

        <label class="field">
          <span class="label">{{ i18n.t('settings.fov') }}</span>
          <select [value]="selectValue()" (change)="onFov($event)">
            @for (opt of fovOptions(); track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </label>
        <p class="hint">{{ i18n.t('settings.fovHint') }}</p>

        <p class="label">{{ i18n.t('settings.level') }}</p>
        <div class="segmented" role="group" [attr.aria-label]="i18n.t('settings.level')">
          @for (l of levels; track l.id) {
            <button
              type="button"
              [class.active]="prefs.level() === l.id"
              [attr.aria-pressed]="prefs.level() === l.id"
              (click)="prefs.setLevel(l.id)"
            >
              {{ i18n.t(l.key) }}
            </button>
          }
        </div>
        <p class="hint">
          {{ i18n.t('settings.levelHint', { enter: prefs.levelEnter(), exit: prefs.levelExit() }) }}
        </p>

        <label class="switch-row">
          <span class="switch-text">
            <strong>{{ i18n.t('settings.autoShoot') }}</strong>
            <small>{{ i18n.t('settings.autoShootHint') }}</small>
          </span>
          <input
            type="checkbox"
            class="switch"
            [checked]="prefs.autoShoot()"
            (change)="onAutoShoot($event)"
          />
        </label>
      </section>

      <!-- Avisos -->
      <section class="card group">
        <h2>{{ i18n.t('settings.notices') }}</h2>
        <p class="muted">{{ i18n.t('settings.noticesBody') }}</p>
        <span class="chip">{{ i18n.t('settings.comingSoon') }}</span>
      </section>
    </section>
  `,
  styleUrl: './settings.scss',
})
export class Settings {
  protected readonly prefs = inject(PreferencesService);
  protected readonly i18n = inject(I18nService);

  protected readonly languages: { id: Locale; label: string }[] = [
    { id: 'es', label: 'Español' },
    { id: 'en', label: 'English' },
  ];

  protected readonly themes: { id: ThemeMode; key: MessageKey }[] = [
    { id: 'system', key: 'settings.themeSystem' },
    { id: 'light', key: 'settings.themeLight' },
    { id: 'dark', key: 'settings.themeDark' },
  ];

  protected readonly accents: { id: Accent; key: MessageKey; color: string }[] = [
    { id: 'green', key: 'settings.accentGreen', color: '#16a34a' },
    { id: 'blue', key: 'settings.accentBlue', color: '#2563eb' },
    { id: 'orange', key: 'settings.accentOrange', color: '#ea580c' },
    { id: 'pink', key: 'settings.accentPink', color: '#db2777' },
    { id: 'violet', key: 'settings.accentViolet', color: '#9463f7' },
  ];

  protected readonly levels: { id: LevelSensitivity; key: MessageKey }[] = [
    { id: 'strict', key: 'settings.levelStrict' },
    { id: 'normal', key: 'settings.levelNormal' },
    { id: 'relaxed', key: 'settings.levelRelaxed' },
  ];

  protected readonly fovOptions = computed(() => [
    { value: 'auto', label: this.i18n.t('settings.fovAuto') },
    { value: '60', label: '60°' },
    { value: '65', label: '65°' },
    { value: '70', label: '70°' },
    { value: '75', label: '75°' },
    { value: '80', label: '80°' },
  ]);

  protected selectValue(): string {
    const fov = this.prefs.fovDeg();
    return fov === null ? 'auto' : String(fov);
  }

  protected onFov(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.prefs.setFov(value === 'auto' ? null : Number(value));
  }

  protected onAutoShoot(event: Event): void {
    this.prefs.setAutoShoot((event.target as HTMLInputElement).checked);
  }
}
