import { Component, inject } from '@angular/core';
import { Accent, LevelSensitivity, PreferencesService, ThemeMode } from '../../core/preferences.service';

@Component({
  selector: 'app-settings',
  template: `
    <section class="page">
      <h1>Configuración</h1>
      <p class="muted">Ajustes de la app guardados en este dispositivo.</p>

      <!-- Apariencia -->
      <section class="card group">
        <h2>Apariencia</h2>

        <p class="label">Tema</p>
        <div class="segmented" role="group" aria-label="Tema">
          @for (t of themes; track t.id) {
            <button
              type="button"
              [class.active]="prefs.theme() === t.id"
              [attr.aria-pressed]="prefs.theme() === t.id"
              (click)="prefs.setTheme(t.id)"
            >
              {{ t.label }}
            </button>
          }
        </div>

        <p class="label">Color de acento</p>
        <div class="swatches" role="group" aria-label="Color de acento">
          @for (a of accents; track a.id) {
            <button
              type="button"
              class="swatch"
              [class.active]="prefs.accent() === a.id"
              [style]="{ '--swatch': a.color }"
              [attr.aria-label]="a.label"
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
        <h2>Cámara</h2>

        <label class="field">
          <span class="label">Campo de visión (horizontal)</span>
          <select [value]="selectValue()" (change)="onFov($event)">
            @for (opt of fovOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
        </label>
        <p class="hint">
          Si conoces el FOV de tu cámara, el volumen sale más preciso. «Automático» usa el EXIF de
          la foto y, si no hay, 65°.
        </p>

        <p class="label">Sensibilidad del nivel</p>
        <div class="segmented" role="group" aria-label="Sensibilidad del nivel">
          @for (l of levels; track l.id) {
            <button
              type="button"
              [class.active]="prefs.level() === l.id"
              [attr.aria-pressed]="prefs.level() === l.id"
              (click)="prefs.setLevel(l.id)"
            >
              {{ l.label }}
            </button>
          }
        </div>
        <p class="hint">
          El aro se pone verde a {{ prefs.levelEnter() }}° y se pierde a {{ prefs.levelExit() }}°.
          Cuanto más estricta, más cenital tiene que estar la foto.
        </p>
      </section>

      <!-- Avisos -->
      <section class="card group">
        <h2>Avisos</h2>
        <p class="muted">
          Recordatorios para registrar tus comidas. Necesitan permiso de notificaciones y llegarán
          en una próxima versión.
        </p>
        <span class="chip">Próximamente</span>
      </section>
    </section>
  `,
  styleUrl: './settings.scss',
})
export class Settings {
  protected readonly prefs = inject(PreferencesService);

  protected readonly themes: { id: ThemeMode; label: string }[] = [
    { id: 'system', label: 'Sistema' },
    { id: 'light', label: 'Claro' },
    { id: 'dark', label: 'Oscuro' },
  ];

  protected readonly accents: { id: Accent; label: string; color: string }[] = [
    { id: 'green', label: 'Verde', color: '#16a34a' },
    { id: 'blue', label: 'Azul', color: '#2563eb' },
    { id: 'orange', label: 'Naranja', color: '#ea580c' },
    { id: 'pink', label: 'Rosa', color: '#db2777' },
    { id: 'violet', label: 'Violeta', color: '#7c3aed' },
  ];

  protected readonly levels: { id: LevelSensitivity; label: string }[] = [
    { id: 'strict', label: 'Estricta' },
    { id: 'normal', label: 'Normal' },
    { id: 'relaxed', label: 'Flexible' },
  ];

  protected readonly fovOptions = [
    { value: 'auto', label: 'Automático' },
    { value: '60', label: '60°' },
    { value: '65', label: '65°' },
    { value: '70', label: '70°' },
    { value: '75', label: '75°' },
    { value: '80', label: '80°' },
  ];

  protected selectValue(): string {
    const fov = this.prefs.fovDeg();
    return fov === null ? 'auto' : String(fov);
  }

  protected onFov(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.prefs.setFov(value === 'auto' ? null : Number(value));
  }
}
