import { DecimalPipe, DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { FoodLogService } from '../../core/food-log/food-log.service';
import { ResultStore } from '../../core/food-log/result.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { CatalogFood, Confidence, DetectedFood, PipelineWarning } from '../../core/models';
import { MessageKey } from '../../core/i18n/messages';
import { TILT_WARN_DEG } from '../../core/tilt.service';

/** Traducción de los motivos que bajan la confianza del análisis. */
const CONFIDENCE_REASONS: Record<string, MessageKey> = {
  escala_supuesta: 'confidence.reason.escalaSupuesta',
  escala_sin_referencia: 'confidence.reason.escalaSinReferencia',
  camara_inclinada: 'confidence.reason.camaraInclinada',
  camara_algo_inclinada: 'confidence.reason.camaraAlgoInclinada',
  clasificacion_baja: 'confidence.reason.clasificacionBaja',
  clasificacion_muy_baja: 'confidence.reason.clasificacionMuyBaja',
  clasificacion_desconocida: 'confidence.reason.clasificacionDesconocida',
  densidad_asumida: 'confidence.reason.densidadAsumida',
  volumen_recortado: 'confidence.reason.volumenRecortado',
};

/** Diámetros de plato ofrecidos para reescalar sin reprocesar la foto. */
const PLATE_SIZES_CM = [22, 26, 30] as const;
/** Duración de la animación de salida del bottom-sheet (sincronizada con `result.scss`). */
const SHEET_CLOSE_MS = 240;
/** Duración del conteo progresivo (count-up) de las calorías totales al revelar el resultado. */
const KCAL_COUNT_MS = 550;

/** Nutrientes extendidos, agrupados como en una etiqueta nutricional. */
const NUTRIENT_GROUPS: {
  key: string;
  label: MessageKey;
  rows: { code: string; label: MessageKey; unit: string }[];
}[] = [
  {
    key: 'general',
    label: 'nutrient.groupGeneral',
    rows: [
      { code: 'agua_g', label: 'nutrient.water', unit: 'g' },
      { code: 'fibra_g', label: 'nutrient.fiber', unit: 'g' },
      { code: 'azucares_g', label: 'nutrient.sugars', unit: 'g' },
      { code: 'sodio_mg', label: 'nutrient.sodium', unit: 'mg' },
    ],
  },
  {
    key: 'fats',
    label: 'nutrient.groupFats',
    rows: [
      { code: 'grasas_saturadas_g', label: 'nutrient.saturated', unit: 'g' },
      { code: 'grasas_mono_g', label: 'nutrient.mono', unit: 'g' },
      { code: 'grasas_poli_g', label: 'nutrient.poly', unit: 'g' },
      { code: 'grasas_trans_g', label: 'nutrient.trans', unit: 'g' },
      { code: 'colesterol_mg', label: 'nutrient.cholesterol', unit: 'mg' },
    ],
  },
  {
    key: 'minerals',
    label: 'nutrient.groupMinerals',
    rows: [
      { code: 'calcio_mg', label: 'nutrient.calcium', unit: 'mg' },
      { code: 'hierro_mg', label: 'nutrient.iron', unit: 'mg' },
      { code: 'magnesio_mg', label: 'nutrient.magnesium', unit: 'mg' },
      { code: 'fosforo_mg', label: 'nutrient.phosphorus', unit: 'mg' },
      { code: 'potasio_mg', label: 'nutrient.potassium', unit: 'mg' },
      { code: 'zinc_mg', label: 'nutrient.zinc', unit: 'mg' },
      { code: 'cobre_mg', label: 'nutrient.copper', unit: 'mg' },
      { code: 'manganeso_mg', label: 'nutrient.manganese', unit: 'mg' },
      { code: 'selenio_ug', label: 'nutrient.selenium', unit: 'µg' },
    ],
  },
  {
    key: 'vitamins',
    label: 'nutrient.groupVitamins',
    rows: [
      { code: 'vitamina_c_mg', label: 'nutrient.vitC', unit: 'mg' },
      { code: 'tiamina_mg', label: 'nutrient.thiamin', unit: 'mg' },
      { code: 'riboflavina_mg', label: 'nutrient.riboflavin', unit: 'mg' },
      { code: 'niacina_mg', label: 'nutrient.niacin', unit: 'mg' },
      { code: 'vitamina_b6_mg', label: 'nutrient.vitB6', unit: 'mg' },
      { code: 'folato_ug', label: 'nutrient.folate', unit: 'µg' },
      { code: 'colina_mg', label: 'nutrient.choline', unit: 'mg' },
      { code: 'vitamina_b12_ug', label: 'nutrient.vitB12', unit: 'µg' },
      { code: 'vitamina_a_ug', label: 'nutrient.vitA', unit: 'µg' },
      { code: 'vitamina_d_ug', label: 'nutrient.vitD', unit: 'µg' },
      { code: 'vitamina_e_mg', label: 'nutrient.vitE', unit: 'mg' },
      { code: 'vitamina_k_ug', label: 'nutrient.vitK', unit: 'µg' },
    ],
  },
];

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
        @if (fromHistory()) {
          <a class="back-link" routerLink="/history">← {{ i18n.t('result.backHistory') }}</a>
        }

        <figure class="photo" [style.aspect-ratio]="aspect()">
          @if (photo(); as src) {
            <img [src]="src" [attr.alt]="i18n.t('result.photoAlt')" (load)="onPhotoLoad($event)" />
          }

          <!-- Zonas segmentadas: contorno + etiqueta con nombre y calorías -->
          @if (photo() && segments().length) {
            <svg class="overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
              @for (s of segments(); track s.key) {
                <polygon [attr.points]="s.points" pathLength="1" [style.--i]="$index" />
                @if (s.ly !== s.cy) {
                  <line
                    [attr.x1]="s.cx"
                    [attr.y1]="s.cy"
                    [attr.x2]="s.lx"
                    [attr.y2]="s.ly"
                    pathLength="1"
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
          @if (scaleWarning()) {
            <aside class="card tilt-warn" role="status">
              <span class="icon" aria-hidden="true">📏</span>
              <div>
                <strong>{{ i18n.t('result.scaleTitle') }}</strong>
                <p>{{ i18n.t('result.scaleBody') }}</p>
              </div>
            </aside>
          }

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
              <strong>{{ animatedKcal() | number: '1.0-0' }}</strong>
              <span>{{ i18n.t('result.kcalTotal') }}</span>
            </div>

            @if (r.peso_total) {
              <p class="grams-total">
                {{ i18n.t('result.totalWeight', { grams: (r.peso_total | number: '1.0-0') ?? '' }) }}
              </p>
            }

            @if (r.confianza; as c) {
              <div class="confidence" [class.confidence--media]="c.nivel === 'media'" [class.confidence--baja]="c.nivel === 'baja'">
                <span class="confidence__dot" aria-hidden="true"></span>
                <b>{{ i18n.t('result.confidenceLevel', { level: i18n.t(confidenceLabel(c)) }) }}</b>
                @if (c.motivos.length) {
                  <ul class="confidence__reasons">
                    @for (reason of c.motivos; track reason) {
                      <li>{{ i18n.t(reasonLabel(reason)) }}</li>
                    }
                  </ul>
                }
              </div>
            }

            @if (r.escala_origen === 'plate') {
              <div class="plate-size" role="group" [attr.aria-label]="i18n.t('result.plateSize')">
                <span class="plate-size__label">{{ i18n.t('result.plateSize') }}</span>
                @for (cm of plateSizes; track cm) {
                  <button
                    type="button"
                    class="plate-size__btn"
                    [class.is-active]="r.plate_diameter_cm === cm"
                    [disabled]="saving()"
                    (click)="setPlate(cm)"
                  >
                    {{ cm }} cm
                  </button>
                }
              </div>
            }

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
          @if (r.alimentos.length) {
            <h2>{{ i18n.t('result.foods', { count: r.alimentos.length }) }}</h2>
            <ul class="foods">
              @for (f of r.alimentos; track $index) {
                <li class="food-item" [style.--i]="$index">
                  <button type="button" class="food" (click)="openSheet(f, $index)">
                    <span class="food-idx" aria-hidden="true">{{ $index + 1 }}</span>
                    <span class="food-name">{{ foodName(f) }}</span>
                    <span class="food-kcal">{{ f.nutricion.calorias_kcal | number: '1.0-0' }} kcal</span>
                    @if (needsReview(f)) {
                      <span
                        class="food-check"
                        [attr.title]="i18n.t('result.reviewFood')"
                        [attr.aria-label]="i18n.t('result.reviewFood')"
                        >?</span
                      >
                    }
                    <span class="chev" aria-hidden="true">›</span>
                  </button>
                </li>
              }
            </ul>
          } @else if (r.contornos.length) {
            <p class="note">{{ i18n.t('result.oldScan') }}</p>
          }

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
          [class.sheet--open]="isSheetOpen() && !isSheetClosing()"
          [class.sheet--closing]="isSheetClosing()"
          (click)="onSheetClick($event)"
          (cancel)="onSheetCancel($event)"
          (close)="onSheetNativeClose()"
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

                @if (nutrientGroups(f).length) {
                  <details class="nutrients">
                    <summary>{{ i18n.t('result.allNutrients') }}</summary>
                    @for (group of nutrientGroups(f); track group.key) {
                      <h4>{{ i18n.t(group.label) }}</h4>
                      <dl class="facts facts--muted">
                        @for (row of group.rows; track row.code) {
                          <div>
                            <dt>{{ i18n.t(row.label) }}</dt>
                            <dd>{{ row.value | number: '1.0-2' }} {{ row.unit }}</dd>
                          </div>
                        }
                      </dl>
                    }
                    <p class="note">{{ i18n.t('result.per100Note') }}</p>
                  </details>
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
                  <dd>
                    @if (f.confianza != null) {
                      {{ f.confianza * 100 | number: '1.0-0' }}%
                    } @else {
                      —
                    }
                  </dd>
                </div>
              </dl>

              @if (f.densidad_asumida) {
                <p class="note">{{ i18n.t('result.densityAssumed') }}</p>
              }

              @if (result()?.editable) {
                <section class="edit">
                  <h3>{{ i18n.t('result.editTitle') }}</h3>

                  <label class="edit-grams">
                    <span>{{ i18n.t('result.gramsLabel') }}</span>
                    <input
                      type="number"
                      inputmode="numeric"
                      min="1"
                      max="5000"
                      step="1"
                      [value]="f.peso_g | number: '1.0-0' : i18n.dateLocale()"
                      [disabled]="saving()"
                      (change)="setGrams($event)"
                    />
                    <span>g</span>
                  </label>

                  <div class="edit-search">
                    <label for="food-search">{{ i18n.t('result.changeFood') }}</label>
                    <input
                      id="food-search"
                      type="search"
                      autocomplete="off"
                      [placeholder]="i18n.t('result.changeFoodPlaceholder')"
                      [disabled]="saving()"
                      (input)="onSearch($event)"
                    />
                    @if (searching()) {
                      <p class="note">{{ i18n.t('result.searching') }}</p>
                    }
                    @if (searchResults().length) {
                      <ul class="search-results">
                        @for (c of searchResults(); track c.idx) {
                          <li>
                            <button type="button" [disabled]="saving()" (click)="chooseFood(c)">
                              <b>{{ c.nombre_es }}</b>
                              <span>{{ c.por_100g.calorias_kcal | number: '1.0-0' }} kcal / 100 g</span>
                            </button>
                          </li>
                        }
                      </ul>
                    }
                  </div>

                  @if (editError(); as key) {
                    <p class="note note--error" role="alert">{{ i18n.t(key) }}</p>
                  }
                </section>
              }
            </article>
          }
        </dialog>
      </section>
    } @else if (loading()) {
      <section class="page empty">
        <span class="spinner" aria-hidden="true"></span>
        <p class="muted">{{ i18n.t('result.loading') }}</p>
      </section>
    } @else if (notFound()) {
      <section class="page empty">
        <p class="muted">{{ i18n.t('result.notFound') }}</p>
        <a class="btn btn--primary" routerLink="/history">{{ i18n.t('result.backHistory') }}</a>
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
export class Result implements OnDestroy {
  private readonly store = inject(ResultStore);
  private readonly logs = inject(FoodLogService);
  private readonly route = inject(ActivatedRoute);
  protected readonly i18n = inject(I18nService);
  protected readonly result = this.store.result;

  private readonly sheet = viewChild<ElementRef<HTMLDialogElement>>('sheet');

  protected readonly plateSizes = PLATE_SIZES_CM;
  protected readonly saving = signal(false);
  protected readonly editError = signal<'result.editError' | 'result.editRange' | null>(null);
  protected readonly searchResults = signal<CatalogFood[]>([]);
  protected readonly searching = signal(false);
  /** Cargando un análisis del historial (/result/:id) o no encontrado. */
  protected readonly loading = signal(false);
  protected readonly notFound = signal(false);
  protected readonly fromHistory = signal(false);
  protected readonly isSheetClosing = signal(false);
  protected readonly animatedKcal = signal(0);
  private searchTimer?: ReturnType<typeof setTimeout>;
  private sheetCloseTimer?: ReturnType<typeof setTimeout>;
  private kcalRafId?: number;
  /** Último total ya mostrado: en las correcciones se anima desde aquí, no desde cero. */
  private lastKcalTarget?: number;
  private loadSub?: Subscription;

  constructor() {
    // Bloquea el scroll y aplica el efecto 3D de profundidad sobre `<main>` mientras la hoja está abierta.
    effect((onCleanup) => {
      const active = this.isSheetOpen() && !this.isSheetClosing();
      document.body.classList.toggle('sheet-open', active);
      onCleanup(() => document.body.classList.remove('sheet-open'));
    });

    // Interpola el contador de calorías totales: de 0 al total la primera vez y, en las
    // correcciones, desde el valor que ya se estaba mostrando.
    effect((onCleanup) => {
      const res = this.result();
      if (!res) {
        this.cancelKcalRaf();
        this.lastKcalTarget = undefined;
        this.animatedKcal.set(0);
        return;
      }
      const target = Math.round(res.calorias_totales);
      // Leer el valor animado sin crear dependencia: si no, el efecto se relanzaría cada frame.
      const from = this.lastKcalTarget === undefined ? 0 : untracked(() => this.animatedKcal());
      this.lastKcalTarget = target;
      this.animateKcal(target, from);
      onCleanup(() => this.cancelKcalRaf());
    });

    // /result/:id abre un análisis guardado (desde el historial); /result llega del store en
    // memoria que acaba de rellenar la captura.
    this.loadSub = this.route.paramMap.subscribe((params) => {
      const raw = params.get('id');
      if (!raw) {
        this.fromHistory.set(false);
        return;
      }
      this.fromHistory.set(true);
      this.load(Number(raw));
    });
  }

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
      typeof w === 'string'
        ? !w.includes('poco cenital')
        : w.code !== 'tilt' && w.code !== 'no_plate_reference',
    ),
  );

  /**
   * Sin borde de plato no hay escala: el volumen que da el modelo de profundidad en primeros
   * planos puede estar muy desviado, así que se avisa arriba, no en la letra pequeña.
   */
  protected readonly scaleWarning = computed(() =>
    (this.store.result()?.advertencias ?? []).some(
      (w) => typeof w !== 'string' && w.code === 'no_plate_reference',
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
      case 'volume_clamped':
        return this.i18n.t('warning.volumeClamped');
      default:
        return w.code;
    }
  }

  /** Etiqueta del nivel de confianza y de cada motivo (claves i18n). */
  protected confidenceLabel(confianza: Confidence): MessageKey {
    return confianza.nivel === 'alta'
      ? 'confidence.alta'
      : confianza.nivel === 'media'
        ? 'confidence.media'
        : 'confidence.baja';
  }

  protected reasonLabel(code: string): MessageKey {
    return CONFIDENCE_REASONS[code] ?? 'confidence.reason.unknown';
  }

  /** Alimento con clasificación dudosa que el usuario aún no ha revisado. */
  protected needsReview(food: DetectedFood): boolean {
    return (
      !food.clase_editada &&
      !food.peso_manual &&
      food.confianza != null &&
      food.confianza < 0.15
    );
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

  /** Nutrientes del alimento agrupados, omitiendo los que la tabla no trae. */
  protected nutrientGroups(food: DetectedFood): {
    key: string;
    label: MessageKey;
    rows: { code: string; label: MessageKey; unit: string; value: number }[];
  }[] {
    const detail = food.detalle ?? {};
    return NUTRIENT_GROUPS.map((group) => ({
      key: group.key,
      label: group.label,
      rows: group.rows
        .filter((row) => detail[row.code] != null)
        .map((row) => ({ ...row, value: detail[row.code] })),
    })).filter((group) => group.rows.length > 0);
  }

  protected openSheet(food: DetectedFood, index: number): void {
    this.clearSheetCloseTimer();
    this.isSheetClosing.set(false);
    this.selected.set(food);
    this.selectedIndex.set(index);
    this.editError.set(null);
    this.searchResults.set([]);
    const dialog = this.sheet()?.nativeElement;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  protected closeSheet(): void {
    if (!this.isSheetOpen() || this.isSheetClosing()) return;
    this.isSheetClosing.set(true);
    this.sheetCloseTimer = setTimeout(() => {
      this.sheetCloseTimer = undefined;
      this.sheet()?.nativeElement.close();
      this.selected.set(null);
      this.isSheetClosing.set(false);
    }, SHEET_CLOSE_MS);
  }

  protected onSheetCancel(event: Event): void {
    event.preventDefault();
    this.closeSheet();
  }

  protected onSheetNativeClose(): void {
    this.clearSheetCloseTimer();
    this.selected.set(null);
    this.isSheetClosing.set(false);
  }

  /** Corrige los gramos del alimento abierto. */
  protected setGrams(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value) || value < 1 || value > 5000) {
      this.editError.set('result.editRange');
      return;
    }
    this.patch({ items: [{ index: this.selectedIndex(), peso_g: Math.round(value) }] });
  }

  /** Busca en el catálogo para corregir un alimento mal clasificado (con retardo al teclear). */
  protected onSearch(event: Event): void {
    const query = (event.target as HTMLInputElement).value.trim();
    if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
    if (query.length < 2) {
      this.searchResults.set([]);
      this.searching.set(false);
      return;
    }
    this.searching.set(true);
    this.searchTimer = setTimeout(() => {
      this.logs.searchFoods(query).subscribe({
        next: (res) => {
          this.searchResults.set(res.resultados);
          this.searching.set(false);
        },
        error: () => this.searching.set(false),
      });
    }, 250);
  }

  protected chooseFood(food: CatalogFood): void {
    this.searchResults.set([]);
    this.patch({ items: [{ index: this.selectedIndex(), idx: food.idx }] });
  }

  /** Reescala el análisis completo con el diámetro real del plato (26 cm por defecto). */
  protected setPlate(cm: number): void {
    const current = this.result();
    if (!current || current.escala_origen !== 'plate' || current.plate_diameter_cm === cm) return;
    this.patch({ plate_diameter_cm: cm });
  }

  private patch(body: {
    items?: { index: number; idx?: number; peso_g?: number }[];
    plate_diameter_cm?: number;
  }): void {
    const current = this.result();
    if (!current || this.saving()) return;
    this.saving.set(true);
    this.editError.set(null);
    this.logs.update(current.id, body).subscribe({
      next: (updated) => {
        // El servidor devuelve los totales y el detalle ya recalculados.
        this.store.set(updated, this.store.preview() ?? updated.imagen_url);
        this.selected.set(updated.alimentos[this.selectedIndex()] ?? null);
        this.saving.set(false);
      },
      error: () => {
        this.saving.set(false);
        this.editError.set('result.editError');
      },
    });
  }

  /** Cierra al tocar el fondo (fuera del contenido), no al tocar la hoja. */
  protected onSheetClick(event: MouseEvent): void {
    if (event.target === this.sheet()?.nativeElement) this.closeSheet();
  }

  ngOnDestroy(): void {
    if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
    this.clearSheetCloseTimer();
    this.cancelKcalRaf();
    this.loadSub?.unsubscribe();
  }

  private animateKcal(target: number, from = 0): void {
    this.cancelKcalRaf();
    if (target <= 0 || from === target || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.animatedKcal.set(target);
      return;
    }

    const duration = from === 0 ? KCAL_COUNT_MS : 350;
    const start = performance.now();

    const tick = (now: number): void => {
      const elapsed = now - start;
      const progress = Math.min(1, Math.max(0, elapsed / duration));
      // Suavizado ease-out-quart: aceleración rápida al inicio y frenado suave al llegar al total.
      const eased = 1 - Math.pow(1 - progress, 4);
      this.animatedKcal.set(Math.round(from + (target - from) * eased));

      if (progress < 1) {
        this.kcalRafId = requestAnimationFrame(tick);
      } else {
        this.kcalRafId = undefined;
        this.animatedKcal.set(target);
      }
    };

    this.kcalRafId = requestAnimationFrame(tick);
  }

  private cancelKcalRaf(): void {
    if (this.kcalRafId !== undefined) {
      cancelAnimationFrame(this.kcalRafId);
      this.kcalRafId = undefined;
    }
  }

  private clearSheetCloseTimer(): void {
    if (this.sheetCloseTimer !== undefined) {
      clearTimeout(this.sheetCloseTimer);
      this.sheetCloseTimer = undefined;
    }
  }

  private load(id: number): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.logs.get(id).subscribe({
      next: (detail) => {
        // El servidor no guarda los avisos del pipeline; la ficha funciona igual sin ellos.
        this.store.set({ ...detail, advertencias: [] }, null);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notFound.set(true);
      },
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(points: number[][], axis: 0 | 1): number {
  return points.reduce((acc, p) => acc + p[axis], 0) / points.length;
}


