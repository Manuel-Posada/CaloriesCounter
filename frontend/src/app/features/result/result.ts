import { DecimalPipe, DatePipe } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ResultStore } from '../../core/food-log/result.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { DetectedFood, PipelineWarning } from '../../core/models';
import { TILT_WARN_DEG } from '../../core/tilt.service';

/** Zona segmentada lista para pintar sobre la foto. */
interface RenderedSegment {
  key: string;
  n: number;
  /** Centro de la zona (para el punto numerado). */
  cx: number;
  cy: number;
  /** Punto donde se ancla la etiqueta (puede separarse para no solaparse). */
  lx: number;
  ly: number;
  /** Etiqueta por debajo del centro (zonas pegadas al borde superior). */
  below: boolean;
  label: string;
  kcal: number;
  /** Atributo `points` del `<polygon>`. */
  points: string;
}

@Component({
  selector: 'app-result',
  imports: [DecimalPipe, DatePipe, RouterLink],
  template: `
    @if (result(); as r) {
      <section class="page">
        <figure class="photo" [style.aspect-ratio]="aspect()">
          @if (photo(); as src) {
            <img [src]="src" [attr.alt]="i18n.t('result.photoAlt')" (load)="onPhotoLoad($event)" />
          }

          <!-- Zonas segmentadas: contorno + etiqueta con nombre y calorías -->
          @if (photo() && segments().length) {
            <svg class="overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              @for (s of segments(); track s.key) {
                <polygon [attr.points]="s.points" [style.--i]="$index" />
                @if (s.ly !== s.cy) {
                  <line
                    [attr.x1]="s.cx"
                    [attr.y1]="s.cy"
                    [attr.x2]="s.lx"
                    [attr.y2]="s.ly"
                    [style.--i]="$index"
                  />
                }
              }
            </svg>

            @for (s of segments(); track s.key) {
              <span
                class="tag"
                [class.tag--below]="s.below"
                [style.left.%]="s.lx * 100"
                [style.top.%]="s.ly * 100"
                [style.--i]="$index"
              >
                <span class="tag-idx" aria-hidden="true">{{ s.n }}</span>
                <b>{{ s.label }}</b>
                <span class="tag-kcal">{{ s.kcal | number: '1.0-0' }} kcal</span>
              </span>
            }
          }

          <figcaption class="chip">{{ r.fecha_hora | date: i18n.shortDate() : undefined : i18n.dateLocale() }}</figcaption>
          @if (tiltOk(); as t) {
            <span class="chip tilt-ok">{{ i18n.t('result.centered', { deg: (t | number: '1.0-0') ?? '' }) }}</span>
          }
        </figure>

        <div class="results-panel">
          <!-- Aviso de foto no cenital: el volumen puede estar sobreestimado -->
          @if (tiltWarning(); as t) {
            <aside class="card tilt-warn" role="status">
              <span class="icon" aria-hidden="true">📐</span>
              <div>
                <strong>{{ i18n.t('result.tiltTitle', { deg: (t | number: '1.0-0') ?? '' }) }}</strong>
                <p>{{ i18n.t('result.tiltBody') }}</p>
              </div>
            </aside>
          }

          <!-- Consejo de Gemini -->
          @if (r.consejo_nutricional) {
            <aside class="advice" [attr.aria-label]="i18n.t('result.advice')">
              <span class="spark" aria-hidden="true">✨</span>
              <p>{{ r.consejo_nutricional }}</p>
            </aside>
          }

          <!-- Resumen calórico -->
          <div class="card summary">
            <div class="kcal">
              <strong>{{ r.calorias_totales | number: '1.0-0' }}</strong>
              <span>{{ i18n.t('result.kcalTotal') }}</span>
            </div>

            <div class="split" role="img" [attr.aria-label]="splitLabel()">
              <span class="seg protein" [style.flex-grow]="split().p"></span>
              <span class="seg carbs" [style.flex-grow]="split().c"></span>
              <span class="seg fat" [style.flex-grow]="split().f"></span>
            </div>

            <ul class="macros">
              <li>
                <i class="protein"></i>{{ i18n.t('result.protein') }}
                <b>{{ r.macronutrientes.proteinas_g | number: '1.0-1' : i18n.dateLocale() }} g</b>
              </li>
              <li>
                <i class="carbs"></i>{{ i18n.t('result.carbs') }}
                <b>{{ r.macronutrientes.carbohidratos_g | number: '1.0-1' : i18n.dateLocale() }} g</b>
              </li>
              <li>
                <i class="fat"></i>{{ i18n.t('result.fat') }}
                <b>{{ r.macronutrientes.grasas_g | number: '1.0-1' : i18n.dateLocale() }} g</b>
              </li>
            </ul>
          </div>

          <!-- Detalle por alimento -->
          <h2>{{ i18n.t('result.foods', { count: r.alimentos.length }) }}</h2>
          <ul class="foods">
            @for (f of r.alimentos; track $index) {
              <li class="food-item" [style.--i]="$index">
                <button type="button" class="food" (click)="openSheet(f, $index)">
                  <span class="food-idx" aria-hidden="true">{{ $index + 1 }}</span>
                  <span class="food-name">{{ foodName(f) }}</span>
                  <span class="food-kcal">{{ f.nutricion.calorias_kcal | number: '1.0-0' }} kcal</span>
                  <span class="chev" aria-hidden="true">›</span>
                </button>
              </li>
            }
          </ul>

          @for (w of otherWarnings(); track $index) {
            <p class="note">ℹ️ {{ warningText(w) }}</p>
          }
          <p class="note">{{ i18n.t('result.estimateNote') }}</p>

          <a class="btn btn--primary btn--block" routerLink="/">{{ i18n.t('result.another') }}</a>
        </div>

        <!-- Hoja de detalle nutricional -->
        <dialog
          #sheet
          class="sheet"
          [class.sheet--open]="isSheetOpen()"
          (click)="onSheetClick($event)"
          (close)="selected.set(null)"
        >
          @if (selected(); as f) {
            <article>
              <header class="sheet-head">
                <div>
                  <p class="eyebrow">{{ i18n.t('result.food', { n: selectedIndex() + 1 }) }}</p>
                  <h2>{{ foodName(f) }}</h2>
                </div>
                <button
                  type="button"
                  class="close"
                  [attr.aria-label]="i18n.t('result.closeSheet')"
                  (click)="closeSheet()"
                >
                  ✕
                </button>
              </header>

              <section>
                <h3>{{ i18n.t('result.sheetPortion', { grams: (f.peso_g | number: '1.0-0') ?? '' }) }}</h3>
                <dl class="facts">
                  <div>
                    <dt>{{ i18n.t('result.calories') }}</dt>
                    <dd>{{ f.nutricion.calorias_kcal | number: '1.0-0' }} kcal</dd>
                  </div>
                  <div>
                    <dt>{{ i18n.t('result.protein') }}</dt>
                    <dd>{{ f.nutricion.proteinas_g | number: '1.0-1' }} g</dd>
                  </div>
                  <div>
                    <dt>{{ i18n.t('result.carbs') }}</dt>
                    <dd>{{ f.nutricion.carbohidratos_g | number: '1.0-1' }} g</dd>
                  </div>
                  <div>
                    <dt>{{ i18n.t('result.fat') }}</dt>
                    <dd>{{ f.nutricion.grasas_g | number: '1.0-1' }} g</dd>
                  </div>
                </dl>
              </section>

              <section>
                <h3>{{ i18n.t('result.sheetPer100') }}</h3>
                @if (f.nutricion.por_100g; as p) {
                  <dl class="facts facts--muted">
                    <div>
                      <dt>{{ i18n.t('result.calories') }}</dt>
                      <dd>{{ p.calorias_kcal | number: '1.0-0' }} kcal</dd>
                    </div>
                    <div>
                      <dt>{{ i18n.t('result.protein') }}</dt>
                      <dd>{{ p.proteinas_g | number: '1.0-1' }} g</dd>
                    </div>
                    <div>
                      <dt>{{ i18n.t('result.carbs') }}</dt>
                      <dd>{{ p.carbohidratos_g | number: '1.0-1' }} g</dd>
                    </div>
                    <div>
                      <dt>{{ i18n.t('result.fat') }}</dt>
                      <dd>{{ p.grasas_g | number: '1.0-1' }} g</dd>
                    </div>
                  </dl>
                } @else {
                  <p class="note">{{ i18n.t('result.sheetNoPer100') }}</p>
                }
              </section>

              <dl class="meta">
                <div>
                  <dt>{{ i18n.t('result.volume') }}</dt>
                  <dd>{{ f.volumen_cm3 | number: '1.0-0' }} cm³</dd>
                </div>
                <div>
                  <dt>{{ i18n.t('result.density') }}</dt>
                  <dd>{{ f.densidad_g_cm3 | number: '1.0-2' }} g/cm³</dd>
                </div>
                <div>
                  <dt>{{ i18n.t('result.confidence') }}</dt>
                  <dd>{{ f.confianza * 100 | number: '1.0-0' }}%</dd>
                </div>
              </dl>

              @if (f.densidad_asumida) {
                <p class="note">{{ i18n.t('result.densityAssumed') }}</p>
              }
            </article>
          }
        </dialog>
      </section>
    } @else {
      <section class="page empty">
        <p class="muted">{{ i18n.t('result.emptyTitle') }}</p>
        <a class="btn btn--primary" routerLink="/">{{ i18n.t('result.emptyCta') }}</a>
      </section>
    }
  `,
  styleUrl: './result.scss',
})
export class Result {
  private readonly store = inject(ResultStore);
  protected readonly i18n = inject(I18nService);
  protected readonly result = this.store.result;

  private readonly sheet = viewChild<ElementRef<HTMLDialogElement>>('sheet');

  /** Proporción real de la foto, para que el contorno y la imagen coincidan exactamente. */
  protected readonly aspect = signal<string | null>(null);
  protected readonly selected = signal<DetectedFood | null>(null);
  protected readonly selectedIndex = signal(0);
  protected readonly isSheetOpen = computed(() => this.selected() !== null);

  /** Foto local (instantánea) y, si se recarga la página, la URL prefirmada de R2. */
  protected readonly photo = computed(() => this.store.preview() ?? this.store.result()?.imagen_url ?? null);

  /**
   * Zonas segmentadas con su etiqueta colocada. Si dos etiquetas caen cerca se empujan
   * hacia abajo y se une el punto con una línea, para que no se pisen.
   */
  protected readonly segments = computed<RenderedSegment[]>(() => {
    const foods = this.store.result()?.alimentos ?? [];
    const out: RenderedSegment[] = [];
    const placed: { lx: number; ly: number }[] = [];
    const GAP = 0.13;

    foods.forEach((f, i) => {
      const points = f.poligono ?? [];
      if (points.length < 3) return;

      const cx = clamp(f.centroide?.[0] ?? mean(points, 0), 0.04, 0.96);
      const cy = clamp(f.centroide?.[1] ?? mean(points, 1), 0.04, 0.96);
      const below = cy < 0.25;
      const lx = clamp(cx, 0.3, 0.66);

      let ly = cy;
      while (placed.some((p) => Math.abs(p.lx - lx) < 0.5 && Math.abs(p.ly - ly) < GAP)) ly += GAP;
      ly = clamp(ly, 0.04, below ? 0.82 : 0.96);
      placed.push({ lx, ly });

      out.push({
        key: `${i}-${f.idx}`,
        n: i + 1,
        cx,
        cy,
        lx,
        ly,
        below,
        label: this.foodName(f),
        kcal: f.nutricion.calorias_kcal,
        points: points.map((p) => `${p[0]},${p[1]}`).join(' '),
      });
    });

    return out;
  });

  /** Reparto energético (Atwater: 4/4/9 kcal por gramo) para la barra. */
  protected readonly split = computed(() => {
    const m = this.store.result()?.macronutrientes;
    if (!m) return { p: 1, c: 1, f: 1 };
    return { p: m.proteinas_g * 4, c: m.carbohidratos_g * 4, f: m.grasas_g * 9 };
  });

  protected readonly splitLabel = computed(() => {
    const { p, c, f } = this.split();
    const t = p + c + f || 1;
    return this.i18n.t('result.splitLabel', {
      p: Math.round((p / t) * 100),
      c: Math.round((c / t) * 100),
      f: Math.round((f / t) * 100),
    });
  });

  /** Inclinación por encima del umbral: el resultado merece una advertencia. */
  protected readonly tiltWarning = computed(() => {
    const deg = this.store.result()?.angulo_camara_deg;
    return deg != null && deg > TILT_WARN_DEG ? deg : null;
  });

  /** Foto razonablemente cenital: se refuerza con un chip discreto. `null` = no se sabe. */
  protected readonly tiltOk = computed(() => {
    const deg = this.store.result()?.angulo_camara_deg;
    return deg != null && deg <= TILT_WARN_DEG ? deg : null;
  });

  /**
   * Advertencias del pipeline menos la de inclinación: ésa ya la cuenta la tarjeta de arriba
   * con más contexto, y repetirla en la lista solo añade ruido.
   */
  protected readonly otherWarnings = computed(() =>
    (this.store.result()?.advertencias ?? []).filter((w) =>
      typeof w === 'string' ? !w.includes('poco cenital') : w.code !== 'tilt',
    ),
  );

  /** Traduce un aviso por su código; los strings sueltos son de un Modal antiguo. */
  protected warningText(w: string | PipelineWarning): string {
    if (typeof w === 'string') return w;
    switch (w.code) {
      case 'tilt':
        return this.i18n.t('warning.tilt', { deg: w.params?.['deg'] ?? '' });
      case 'class_missing':
        return this.i18n.t('warning.classMissing');
      case 'low_volume':
        return this.i18n.t('warning.lowVolume');
      case 'density_assumed':
        return this.i18n.t('warning.densityAssumed');
      default:
        return w.code;
    }
  }

  protected onPhotoLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight) {
      this.aspect.set(`${img.naturalWidth} / ${img.naturalHeight}`);
    }
  }

  protected pretty(name: string): string {
    const text = name.replace(/_/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Nombre del alimento en el idioma de la interfaz (español del CSV, inglés como respaldo). */
  protected foodName(food: DetectedFood): string {
    const raw = this.i18n.locale() === 'es' && food.nombre_es ? food.nombre_es : food.nombre;
    return this.pretty(raw);
  }

  protected openSheet(food: DetectedFood, index: number): void {
    this.selected.set(food);
    this.selectedIndex.set(index);
    this.sheet()?.nativeElement.showModal();
  }

  protected closeSheet(): void {
    this.sheet()?.nativeElement.close();
  }

  /** Cierra al tocar el fondo (fuera del contenido), no al tocar la hoja. */
  protected onSheetClick(event: MouseEvent): void {
    if (event.target === this.sheet()?.nativeElement) this.closeSheet();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(points: number[][], axis: 0 | 1): number {
  return points.reduce((acc, p) => acc + p[axis], 0) / points.length;
}


