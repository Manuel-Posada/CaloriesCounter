import { DatePipe, DecimalPipe, Location } from '@angular/common';
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
  viewChildren,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { FoodLogService } from '../../core/food-log/food-log.service';
import { ResultStore } from '../../core/food-log/result.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { CatalogFood, Confidence, DetectedFood, FoodLogCreated, PipelineWarning } from '../../core/models';
import { TILT_WARN_DEG } from '../../core/tilt.service';

/** Translation of reasons that lower analysis confidence. */
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

/** Plate diameters offered to rescale without reprocessing the photo. */
const PLATE_SIZES_CM = [22, 26, 30] as const;
/** Bottom-sheet exit animation duration (synced with `result.scss`). */
const SHEET_CLOSE_MS = 240;
/** Pixel threshold (or velocity in px/ms) to close the sheet when swiping down. */
const SHEET_SWIPE_PX = 100;
const SHEET_SWIPE_VELOCITY = 0.45;
/** Duration of the total calories count-up animation when revealing the result. */
const KCAL_COUNT_MS = 550;

/** Extended nutrients, grouped like a nutrition facts label. */
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

/** Segmented zone ready to render over the photo. */
interface RenderedSegment {
  key: string;
  n: number;
  /** Zone center (for the numbered dot). */
  cx: number;
  cy: number;
  /** Anchor point for the label (may be offset to avoid overlap). */
  lx: number;
  ly: number;
  /** Label below the center (for zones near the top edge). */
  below: boolean;
  label: string;
  kcal: number;
  /** `<polygon>` `points` attribute. */
  points: string;
}

@Component({
  selector: 'app-result',
  imports: [DecimalPipe, DatePipe, RouterLink],
  template: `
    @if (gallerySlides().length) {
      <section class="page" [class.page--gallery]="fromHistory()">
        @if (fromHistory()) {
          <header class="gallery-header">
            <div class="gallery-header__top">
              <a class="back-link" routerLink="/history">← {{ i18n.t('result.backHistory') }}</a>
              @if (gallerySlides().length > 1) {
                <span class="chip gallery-counter" aria-live="polite">
                  {{ activeSlideIndex() + 1 }} / {{ gallerySlides().length }}
                </span>
              }
            </div>

            @if (gallerySlides().length > 1) {
              <nav #thumbsBar class="gallery-thumbs" [attr.aria-label]="i18n.t('app.history')">
                @for (item of gallerySlides(); track item.id) {
                  <button
                    type="button"
                    class="gallery-thumb"
                    [class.gallery-thumb--active]="item.id === activeId()"
                    [attr.data-thumb-id]="item.id"
                    [attr.aria-current]="item.id === activeId() ? 'true' : null"
                    (click)="scrollToSlide(item.id, 'smooth')"
                  >
                    @if (slidePhoto(item); as thumbSrc) {
                      <img [src]="thumbSrc" alt="" loading="lazy" />
                    } @else {
                      <span class="gallery-thumb__kcal">{{ item.calorias_totales | number: '1.0-0' }}</span>
                    }
                  </button>
                }
              </nav>
            }
          </header>
        }

        <div
          #galleryTrack
          class="gallery-track"
          [class.gallery-track--single]="!fromHistory() || gallerySlides().length <= 1"
        >
          @for (r of gallerySlides(); track r.id) {
            <article #slideEl class="gallery-slide" [attr.data-log-id]="r.id">
              <div class="gallery-slide__inner">
                <figure
                  class="photo"
                  [class.photo--hero]="r.id === activeId()"
                  [style.aspect-ratio]="slideAspect(r.id)"
                >
                  @if (slidePhoto(r); as src) {
                    <img
                      [src]="src"
                      [attr.alt]="i18n.t('result.photoAlt')"
                      (load)="onSlidePhotoLoad(r.id, $event)"
                    />
                  }

                  <!-- Zonas segmentadas: contorno + etiqueta con nombre y calorías -->
                  @if (slidePhoto(r) && segmentsFor(r).length) {
                    <svg class="overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                      @for (s of segmentsFor(r); track s.key) {
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

                    @for (s of segmentsFor(r); track s.key) {
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

                  <figcaption class="chip">
                    {{ r.fecha_hora | date: i18n.shortDate() : undefined : i18n.dateLocale() }}
                  </figcaption>
                  @if (tiltOkFor(r); as t) {
                    <span class="chip tilt-ok">
                      {{ i18n.t('result.centered', { deg: (t | number: '1.0-0') ?? '' }) }}
                    </span>
                  }
                </figure>

                <div class="results-panel">
                  <!-- Aviso de foto no cenital: el volumen puede estar sobreestimado -->
                  @if (scaleWarningFor(r)) {
                    <aside class="card tilt-warn" role="status">
                      <span class="icon" aria-hidden="true">📏</span>
                      <div>
                        <strong>{{ i18n.t('result.scaleTitle') }}</strong>
                        <p>{{ i18n.t('result.scaleBody') }}</p>
                      </div>
                    </aside>
                  }

                  @if (tiltWarningFor(r); as t) {
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
                      <strong>
                        {{ (r.id === activeId() ? animatedKcal() : r.calorias_totales) | number: '1.0-0' }}
                      </strong>
                      <span>{{ i18n.t('result.kcalTotal') }}</span>
                    </div>

                    @if (r.peso_total) {
                      <p class="grams-total">
                        {{ i18n.t('result.totalWeight', { grams: (r.peso_total | number: '1.0-0') ?? '' }) }}
                      </p>
                    }

                    @if (r.confianza; as c) {
                      <div
                        class="confidence"
                        [class.confidence--media]="c.nivel === 'media'"
                        [class.confidence--baja]="c.nivel === 'baja'"
                      >
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

                    <div class="split" role="img" [attr.aria-label]="splitLabelFor(r)">
                      <span class="seg protein" [style.flex-grow]="splitFor(r).p"></span>
                      <span class="seg carbs" [style.flex-grow]="splitFor(r).c"></span>
                      <span class="seg fat" [style.flex-grow]="splitFor(r).f"></span>
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
                  } @else if (slideFailed(r)) {
                    <div class="card slide-error">
                      <p class="note">{{ i18n.t('result.slideError') }}</p>
                      <button type="button" class="btn btn--ghost" (click)="retrySlide(r.id)">
                        {{ i18n.t('result.retry') }}
                      </button>
                    </div>
                  } @else if (isSlideLoaded(r)) {
                    <p class="note">{{ i18n.t('result.oldScan') }}</p>
                  } @else {
                    <div class="card">
                      <div class="skeleton" style="height: 16px; width: 48%"></div>
                      <div class="skeleton" style="height: 14px; margin-top: 10px; width: 82%"></div>
                    </div>
                  }

                  @for (w of otherWarningsFor(r); track $index) {
                    <p class="note">ℹ️ {{ warningText(w) }}</p>
                  }
                  <p class="note">{{ i18n.t('result.estimateNote') }}</p>

                  <a class="btn btn--primary btn--block" routerLink="/">{{ i18n.t('result.another') }}</a>

                  @if (confirmDeleteId() === r.id) {
                    <div class="delete-confirm">
                      <p class="note">{{ i18n.t('result.deleteConfirm') }}</p>
                      @if (editError() === 'result.deleteError') {
                        <p class="note note--error" role="alert">{{ i18n.t('result.deleteError') }}</p>
                      }
                      <div class="delete-actions">
                        <button type="button" class="btn btn--ghost" [disabled]="deleting()" (click)="cancelDelete()">
                          {{ i18n.t('result.cancel') }}
                        </button>
                        <button type="button" class="btn btn--danger" [disabled]="deleting()" (click)="deleteLog(r)">
                          {{ i18n.t('result.delete') }}
                        </button>
                      </div>
                    </div>
                  } @else {
                    <button type="button" class="link link--danger" (click)="requestDelete(r.id)">
                      {{ i18n.t('result.deleteLog') }}
                    </button>
                  }
                </div>
              </div>
            </article>
          }
        </div>

        <!-- Hoja de detalle nutricional -->
        <dialog
          #sheet
          class="sheet"
          [class.sheet--open]="isSheetOpen() && !isSheetClosing()"
          [class.sheet--closing]="isSheetClosing()"
          [class.sheet--dragging]="isSheetDragging()"
          [class.sheet--rebounding]="isSheetRebounding()"
          [style.--sheet-drag-y]="sheetDragY() + 'px'"
          [style.transform]="
            isSheetDragging()
              ? 'translateY(' + sheetDragY() + 'px)'
              : isSheetRebounding()
                ? 'translateY(0px)'
                : null
          "
          (click)="onSheetClick($event)"
          (cancel)="onSheetCancel($event)"
          (close)="onSheetNativeClose()"
          (touchstart)="onSheetTouchStart($event)"
          (touchmove)="onSheetTouchMove($event)"
          (touchend)="onSheetTouchEnd()"
          (touchcancel)="onSheetTouchEnd()"
        >
          @if (selected(); as f) {
            <article>
              <div class="sheet__handle" aria-hidden="true"></div>
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
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly i18n = inject(I18nService);
  protected readonly result = this.store.result;

  private readonly sheet = viewChild<ElementRef<HTMLDialogElement>>('sheet');
  private readonly galleryTrack = viewChild<ElementRef<HTMLElement>>('galleryTrack');
  private readonly thumbsBar = viewChild<ElementRef<HTMLElement>>('thumbsBar');
  private readonly slideEls = viewChildren<ElementRef<HTMLElement>>('slideEl');

  protected readonly plateSizes = PLATE_SIZES_CM;
  protected readonly saving = signal(false);
  protected readonly editError = signal<'result.editError' | 'result.editRange' | 'result.deleteError' | null>(null);
  protected readonly searchResults = signal<CatalogFood[]>([]);
  protected readonly searching = signal(false);
  /** Loading a history analysis (/result/:id) or not found. */
  protected readonly loading = signal(false);
  protected readonly notFound = signal(false);
  protected readonly fromHistory = signal(false);
  protected readonly isSheetClosing = signal(false);
  protected readonly sheetDragY = signal(0);
  protected readonly isSheetDragging = signal(false);
  protected readonly isSheetRebounding = signal(false);
  /** Details whose `GET` failed (retry is offered in the slide). */
  protected readonly failedSlideIds = signal<Record<number, boolean>>({});
  /** Two-step confirmation to delete an analysis. */
  protected readonly confirmDeleteId = signal<number | null>(null);
  protected readonly deleting = signal(false);
  protected readonly animatedKcal = signal(0);
  /** Active log ID in the horizontal Scroll Snap carousel. */
  protected readonly activeId = signal<number | null>(null);

  /** Full details (`alimentos` included) already fetched by ID for the gallery. */
  private readonly detailsById = signal<Record<number, FoodLogCreated>>({});
  private readonly loadingSlideIds = signal<Record<number, boolean>>({});
  /** Actual aspect ratio per photo (`w / h`) so each contour matches its image. */
  private readonly aspectsById = signal<Record<number, string>>({});

  private searchTimer?: ReturnType<typeof setTimeout>;
  private sheetCloseTimer?: ReturnType<typeof setTimeout>;
  private kcalRafId?: number;
  private loadSub?: Subscription;
  private initialScrollSynced = false;
  private scrollRaf?: number;
  private canDragSheet = false;
  private sheetStartX = 0;
  private sheetStartY = 0;
  private sheetStartTime = 0;

  /**
   * Horizontal carousel slides (`100vw` each with `scroll-snap-align: center`):
   * - When coming from `/history`, combines the history list with already-loaded details.
   * - When coming from `/capture` (`/result`), shows only the newly analyzed dish.
   */
  protected readonly gallerySlides = computed<FoodLogCreated[]>(() => {
    const current = this.result();
    if (!this.fromHistory()) {
      return current ? [current] : [];
    }

    const list = this.logs.cachedHistory();
    const details = this.detailsById();
    const slides = list.map(
      (item): FoodLogCreated =>
        details[item.id] ??
        (current?.id === item.id
          ? current
          : {
              ...item,
              alimentos: [],
              advertencias: item.advertencias ?? [],
            }),
    );

    if (current && !slides.some((s) => s.id === current.id)) {
      return [current, ...slides];
    }
    return slides;
  });

  protected readonly activeSlideIndex = computed(() => {
    const id = this.activeId();
    const idx = this.gallerySlides().findIndex((s) => s.id === id);
    return idx >= 0 ? idx : 0;
  });

  constructor() {
    // Locks scroll and applies the 3D depth effect on `<main>` while the sheet is open.
    effect((onCleanup) => {
      const active = this.isSheetOpen() && !this.isSheetClosing();
      document.body.classList.toggle('sheet-open', active);
      onCleanup(() => document.body.classList.remove('sheet-open'));
    });

    // Interpolates the total calories counter (0 -> calorias_totales) with ease-out-quart when the active dish changes.
    let lastAnimatedId: number | null = null;
    let lastTarget = 0;
    effect((onCleanup) => {
      const res = this.result();
      if (!res) {
        lastAnimatedId = null;
        lastTarget = 0;
        this.cancelKcalRaf();
        this.animatedKcal.set(0);
        return;
      }
      const nextTarget = Math.round(res.calorias_totales);
      const isSameRecord = lastAnimatedId === res.id;
      const from = isSameRecord ? untracked(() => this.animatedKcal()) : 0;
      lastAnimatedId = res.id;
      lastTarget = nextTarget;
      this.animateKcal(lastTarget, from);
      onCleanup(() => this.cancelKcalRaf());
    });

    // Syncs the carousel on scroll: picks the slide closest to the center as active.
    // More reliable than IntersectionObserver with fast swipes or programmatic scrolling.
    effect((onCleanup) => {
      const track = this.galleryTrack()?.nativeElement;
      const slides = this.slideEls();
      if (!track || slides.length === 0) return;
      const isHistory = this.fromHistory();

      if (isHistory && !this.initialScrollSynced && untracked(() => this.activeId()) !== null) {
        const initialId = untracked(() => this.activeId());
        // Center on the next frame: slide widths are not measured yet when the effect runs.
        requestAnimationFrame(() => {
          if (initialId !== null) this.centerSlide(initialId, 'auto');
          this.initialScrollSynced = true;
        });
      }

      if (!isHistory || slides.length <= 1) return;

      const onScroll = (): void => this.scheduleSlideSync(track);
      track.addEventListener('scroll', onScroll, { passive: true });
      onCleanup(() => {
        track.removeEventListener('scroll', onScroll);
        this.cancelSlideSync();
      });
    });

    // The visible dish must always have its detail: covers fast swipes, thumbnail jumps,
    // and startup; also fetches the next history page when nearing the end.
    effect(() => {
      const id = this.activeId();
      if (id === null || !this.fromHistory()) return;
      const slides = this.gallerySlides();
      const idx = slides.findIndex((slide) => slide.id === id);
      if (idx < 0) return;
      untracked(() => this.ensureSlideDetail(id, true));
      untracked(() => this.prefetchNeighbors(id));
      if (idx >= slides.length - 2 && this.logs.historyHasMore()) {
        this.logs.loadMoreHistory()?.subscribe({ error: () => undefined });
      }
    });

    // /result/:id opens a saved analysis (from history); /result reads from the in-memory
    // store just populated by capture.
    this.loadSub = this.route.paramMap.subscribe((params) => {
      const raw = params.get('id');
      if (!raw) {
        this.fromHistory.set(false);
        this.initialScrollSynced = false;
        this.activeId.set(this.store.result()?.id ?? null);
        return;
      }

      const id = Number(raw);
      this.fromHistory.set(true);
      this.initialScrollSynced = false;
      this.activeId.set(id);

      // If the user lands directly on /result/:id without visiting /history first, preload the list.
      if (this.logs.cachedHistory().length === 0) {
        this.logs.list(1).subscribe({ error: () => void 0 });
      }

      this.load(id);
    });
  }

  protected readonly selected = signal<DetectedFood | null>(null);
  protected readonly selectedIndex = signal(0);
  protected readonly isSheetOpen = computed(() => this.selected() !== null);

  /** Smoothly scrolls the carousel to the selected dish when tapping a thumbnail. */
  protected scrollToSlide(id: number, behavior: ScrollBehavior = 'smooth'): void {
    this.centerSlide(id, behavior);
    if (id !== this.activeId()) {
      this.onSlideSnapped(id);
    }
  }

  /** Centers a slide in the carousel without affecting vertical page scroll. */
  private centerSlide(id: number, behavior: ScrollBehavior = 'smooth'): void {
    const track = this.galleryTrack()?.nativeElement;
    const slide = track?.querySelector<HTMLElement>(`[data-log-id="${id}"]`);
    if (!track || !slide) return;
    const trackRect = track.getBoundingClientRect();
    const slideRect = slide.getBoundingClientRect();
    const delta =
      slideRect.left + slideRect.width / 2 - (trackRect.left + trackRect.width / 2);
    track.scrollTo({ left: Math.max(0, track.scrollLeft + delta), behavior });
  }

  /** Batches scroll events into one animation frame to avoid recalculating on every pixel. */
  private scheduleSlideSync(track: HTMLElement): void {
    if (this.scrollRaf !== undefined) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = undefined;
      this.syncActiveFromScroll(track);
    });
  }

  private cancelSlideSync(): void {
    if (this.scrollRaf !== undefined) {
      cancelAnimationFrame(this.scrollRaf);
      this.scrollRaf = undefined;
    }
  }

  /** The active slide is the one closest to the visible center of the carousel. */
  private syncActiveFromScroll(track: HTMLElement): void {
    const trackRect = track.getBoundingClientRect();
    const center = trackRect.left + trackRect.width / 2;
    let bestId = this.activeId();
    let bestDist = Infinity;
    for (const ref of this.slideEls()) {
      const node = ref.nativeElement;
      const rect = node.getBoundingClientRect();
      const dist = Math.abs(rect.left + rect.width / 2 - center);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = Number(node.getAttribute('data-log-id'));
      }
    }
    if (bestId && Number.isFinite(bestId) && bestId !== this.activeId()) {
      this.onSlideSnapped(bestId);
    }
  }

  /** Runs when a slide snaps in the carousel or is selected from the thumbnails. */
  private onSlideSnapped(id: number): void {
    this.activeId.set(id);
    if (this.fromHistory()) {
      this.location.replaceState(`/result/${id}`);
    }

    // Keeps the active thumbnail visible in the top strip (horizontal only).
    const bar = this.thumbsBar()?.nativeElement;
    const thumb = bar?.querySelector<HTMLElement>(`[data-thumb-id="${id}"]`);
    if (bar && thumb) {
      const barRect = bar.getBoundingClientRect();
      const thumbRect = thumb.getBoundingClientRect();
      const delta = thumbRect.left + thumbRect.width / 2 - (barRect.left + barRect.width / 2);
      bar.scrollTo({ left: Math.max(0, bar.scrollLeft + delta), behavior: 'smooth' });
    }

    const existing = this.detailsById()[id];
    if (existing) {
      this.store.set(existing, null);
    } else {
      this.ensureSlideDetail(id, true);
    }
    this.prefetchNeighbors(id);
  }

  /** Local photo (instant) for recent capture, or the log's presigned R2 URL. */
  protected slidePhoto(slide: FoodLogCreated): string | null {
    if (!this.fromHistory() && this.store.preview()) {
      return this.store.preview();
    }
    return slide.imagen_url ?? null;
  }

  protected slideAspect(id: number): string | null {
    return this.aspectsById()[id] ?? null;
  }

  protected onSlidePhotoLoad(id: number, event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight) {
      const ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
      this.aspectsById.update((cur) => ({ ...cur, [id]: ratio }));
    }
  }

  /** The slide's detail has already been fetched (even if it has no food items: older analyses). */
  protected isSlideLoaded(slide: FoodLogCreated): boolean {
    return !!this.detailsById()[slide.id];
  }

  protected slideFailed(slide: FoodLogCreated): boolean {
    return !!this.failedSlideIds()[slide.id];
  }

  protected retrySlide(id: number): void {
    this.failedSlideIds.update((cur) => ({ ...cur, [id]: false }));
    this.ensureSlideDetail(id, true);
  }

  /**
   * Segmented zones with placed labels for a given log.
   * If the detail is still loading, uses the summary `contornos` from the list to render immediately.
   */
  protected segmentsFor(slide: FoodLogCreated): RenderedSegment[] {
    const out: RenderedSegment[] = [];
    const placed: { lx: number; ly: number }[] = [];
    const GAP = 0.13;

    const items =
      slide.alimentos.length > 0
        ? slide.alimentos.map((f, i) => ({
            key: `${slide.id}-${i}-${f.idx}`,
            poligono: f.poligono ?? [],
            centroide: f.centroide,
            label: this.foodName(f),
            kcal: f.nutricion.calorias_kcal,
          }))
        : (slide.contornos ?? []).map((c, i) => ({
            key: `${slide.id}-c-${i}`,
            poligono: c.poligono ?? [],
            centroide: c.centroide,
            label: this.pretty(c.nombre),
            kcal: c.kcal,
          }));

    items.forEach((item, i) => {
      const points = item.poligono;
      if (points.length < 3) return;

      const cx = clamp(item.centroide?.[0] ?? mean(points, 0), 0.04, 0.96);
      const cy = clamp(item.centroide?.[1] ?? mean(points, 1), 0.04, 0.96);
      const below = cy < 0.25;
      const lx = clamp(cx, 0.3, 0.66);

      let ly = cy;
      while (placed.some((p) => Math.abs(p.lx - lx) < 0.5 && Math.abs(p.ly - ly) < GAP)) ly += GAP;
      ly = clamp(ly, 0.04, below ? 0.82 : 0.96);
      placed.push({ lx, ly });

      out.push({
        key: item.key,
        n: i + 1,
        cx,
        cy,
        lx,
        ly,
        below,
        label: item.label,
        kcal: item.kcal,
        points: points.map((p) => `${p[0]},${p[1]}`).join(' '),
      });
    });

    return out;
  }

  /** Energy split (Atwater: 4/4/9 kcal per gram) for each card's macro bar. */
  protected splitFor(slide: FoodLogCreated): { p: number; c: number; f: number } {
    const m = slide.macronutrientes;
    if (!m) return { p: 1, c: 1, f: 1 };
    return { p: m.proteinas_g * 4, c: m.carbohidratos_g * 4, f: m.grasas_g * 9 };
  }

  protected splitLabelFor(slide: FoodLogCreated): string {
    const { p, c, f } = this.splitFor(slide);
    const t = p + c + f || 1;
    return this.i18n.t('result.splitLabel', {
      p: Math.round((p / t) * 100),
      c: Math.round((c / t) * 100),
      f: Math.round((f / t) * 100),
    });
  }

  /** Tilt above threshold: the result warrants a warning. */
  protected tiltWarningFor(slide: FoodLogCreated): number | null {
    const deg = slide.angulo_camara_deg;
    return deg != null && deg > TILT_WARN_DEG ? deg : null;
  }

  /** Reasonably top-down photo: reinforced with a subtle chip. `null` = unknown. */
  protected tiltOkFor(slide: FoodLogCreated): number | null {
    const deg = slide.angulo_camara_deg;
    return deg != null && deg <= TILT_WARN_DEG ? deg : null;
  }

  protected otherWarningsFor(slide: FoodLogCreated): (string | PipelineWarning)[] {
    return (slide.advertencias ?? []).filter((w) =>
      typeof w === 'string'
        ? !w.includes('poco cenital')
        : w.code !== 'tilt' && w.code !== 'no_plate_reference',
    );
  }

  protected scaleWarningFor(slide: FoodLogCreated): boolean {
    return (slide.advertencias ?? []).some(
      (w) => typeof w !== 'string' && w.code === 'no_plate_reference',
    );
  }

  /** Translates a warning by code; bare strings are from an older Modal response. */
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

  /** Label for the confidence level and each reason (i18n keys). */
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

  /** Food item with uncertain classification not yet reviewed by the user. */
  protected needsReview(food: DetectedFood): boolean {
    return (
      !food.clase_editada &&
      !food.peso_manual &&
      food.confianza != null &&
      food.confianza < 0.15
    );
  }

  protected pretty(name: string): string {
    const text = name.replace(/_/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Food name in the UI language (Spanish from CSV, English fallback). */
  protected foodName(food: DetectedFood): string {
    const raw = this.i18n.locale() === 'es' && food.nombre_es ? food.nombre_es : food.nombre;
    return this.pretty(raw);
  }

  /** Grouped nutrients for the food item, omitting those missing from the table. */
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
    this.isSheetDragging.set(false);
    this.isSheetRebounding.set(false);
    this.sheetDragY.set(0);
    this.selected.set(food);
    this.selectedIndex.set(index);
    this.editError.set(null);
    this.searchResults.set([]);
    const dialog = this.sheet()?.nativeElement;
    if (dialog) {
      dialog.scrollTop = 0;
      if (!dialog.open) dialog.showModal();
    }
  }

  protected closeSheet(): void {
    if (!this.isSheetOpen() || this.isSheetClosing()) return;
    this.isSheetDragging.set(false);
    this.isSheetRebounding.set(false);
    this.isSheetClosing.set(true);
    this.sheetCloseTimer = setTimeout(() => {
      this.sheetCloseTimer = undefined;
      this.sheet()?.nativeElement.close();
      this.selected.set(null);
      this.isSheetClosing.set(false);
      this.sheetDragY.set(0);
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
    this.isSheetDragging.set(false);
    this.isSheetRebounding.set(false);
    this.sheetDragY.set(0);
  }

  /**
   * Starts the swipe-down gesture only if the `.sheet` container (and `article`)
   * is scrolled to the very top (`scrollTop === 0`). If the user has scrolled inside
   * the detail, native vertical scrolling is preserved without closing the sheet accidentally.
   */
  protected onSheetTouchStart(ev: TouchEvent): void {
    const dialog = this.sheet()?.nativeElement;
    if (!dialog || !this.isSheetOpen() || this.isSheetClosing() || ev.touches.length !== 1) return;

    const article = dialog.querySelector('article');
    if (dialog.scrollTop > 0 || (article && article.scrollTop > 0)) {
      this.canDragSheet = false;
      return;
    }

    const target = ev.target as HTMLElement | null;
    if (target?.closest('.search-results, input, select')) {
      this.canDragSheet = false;
      return;
    }

    const t = ev.touches[0]!;
    this.canDragSheet = true;
    this.sheetStartX = t.clientX;
    this.sheetStartY = t.clientY;
    this.sheetStartTime = performance.now();
    this.isSheetDragging.set(false);
    this.sheetDragY.set(0);
  }

  protected onSheetTouchMove(ev: TouchEvent): void {
    if (!this.canDragSheet || ev.touches.length !== 1) return;
    const dialog = this.sheet()?.nativeElement;
    if (!dialog) return;

    if (dialog.scrollTop > 0) {
      this.canDragSheet = false;
      this.isSheetDragging.set(false);
      this.sheetDragY.set(0);
      return;
    }

    const t = ev.touches[0]!;
    const dy = t.clientY - this.sheetStartY;
    const dx = t.clientX - this.sheetStartX;

    if (!this.isSheetDragging()) {
      if (Math.hypot(dx, dy) < 8) return;
      // If the user swipes up (dy < 0) to scroll down the nutrition table
      // or the gesture is horizontal, hand control back to `.sheet` native scroll.
      if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
        this.canDragSheet = false;
        return;
      }
      this.isSheetRebounding.set(false);
      this.isSheetDragging.set(true);
    }

    if (ev.cancelable) ev.preventDefault();
    this.sheetDragY.set(Math.max(0, dy));
  }

  protected onSheetTouchEnd(): void {
    this.canDragSheet = false;
    if (!this.isSheetDragging()) return;

    const offset = this.sheetDragY();
    const dt = Math.max(1, performance.now() - this.sheetStartTime);
    const velocity = offset / dt;
    this.isSheetDragging.set(false);

    if (offset >= SHEET_SWIPE_PX || (offset > 35 && velocity >= SHEET_SWIPE_VELOCITY)) {
      this.closeSheet();
      return;
    }

    this.isSheetRebounding.set(true);
    this.sheetDragY.set(0);
  }

  /** Updates the grams of the open food item. */
  protected setGrams(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(value) || value < 1 || value > 5000) {
      this.editError.set('result.editRange');
      return;
    }
    this.patch({ items: [{ index: this.selectedIndex(), peso_g: Math.round(value) }] });
  }

  /** Searches the catalog to replace a misclassified food item (debounced on input). */
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

  /** Rescales the full analysis using the actual plate diameter (26 cm by default). */
  protected setPlate(cm: number): void {
    const current = this.result();
    if (!current || current.escala_origen !== 'plate' || current.plate_diameter_cm === cm) return;
    this.patch({ plate_diameter_cm: cm });
  }

  protected requestDelete(id: number): void {
    this.editError.set(null);
    this.confirmDeleteId.set(id);
  }

  protected cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  /** Deletes the analysis (with two-step confirmation) and moves to the next dish in the carousel. */
  protected deleteLog(slide: FoodLogCreated): void {
    if (this.deleting()) return;
    const indexBefore = this.gallerySlides().findIndex((item) => item.id === slide.id);
    this.deleting.set(true);
    this.logs.delete(slide.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.confirmDeleteId.set(null);
        this.detailsById.update((cur) => {
          const next = { ...cur };
          delete next[slide.id];
          return next;
        });

        // On a freshly captured result there is no carousel: deleting returns to the camera.
        if (!this.fromHistory()) {
          this.store.clear();
          void this.router.navigate(['/']);
          return;
        }

        const remaining = this.logs.cachedHistory();
        if (!remaining.length) {
          this.store.clear();
          void this.router.navigate([this.fromHistory() ? '/history' : '/']);
          return;
        }

        // Pick the neighbor from the list after deletion. The store must be updated before
        // reading `gallerySlides` again, which re-injects the current result if still in memory.
        const nextItem = remaining[Math.min(Math.max(indexBefore, 0), remaining.length - 1)];
        const nextDetail =
          this.detailsById()[nextItem.id] ??
          ({ ...nextItem, alimentos: [], advertencias: nextItem.advertencias ?? [] } as FoodLogCreated);
        this.store.set(nextDetail, null);
        this.activeId.set(nextItem.id);
        if (this.fromHistory()) this.location.replaceState(`/result/${nextItem.id}`);
        this.centerSlide(nextItem.id, 'auto');
        if (!this.detailsById()[nextItem.id]) this.ensureSlideDetail(nextItem.id, true);
      },
      error: () => {
        this.deleting.set(false);
        this.editError.set('result.deleteError');
      },
    });
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
        // The server returns the recalculated totals and breakdown.
        this.detailsById.update((cur) => ({ ...cur, [updated.id]: updated }));
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

  /** Closes on backdrop click (outside content), not when tapping the sheet. */
  protected onSheetClick(event: MouseEvent): void {
    if (event.target === this.sheet()?.nativeElement) this.closeSheet();
  }

  ngOnDestroy(): void {
    if (this.searchTimer !== undefined) clearTimeout(this.searchTimer);
    this.clearSheetCloseTimer();
    this.cancelKcalRaf();
    this.cancelSlideSync();
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
      // Ease-out-quart smoothing: fast acceleration at the start and gentle deceleration toward the total.
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
    this.ensureSlideDetail(id, true, () => {
      this.loading.set(false);
      this.prefetchNeighbors(id);
    });
  }

  private ensureSlideDetail(id: number, makeActive = false, onDone?: () => void): void {
    const existing = this.detailsById()[id];
    if (existing) {
      if (makeActive) this.store.set(existing, null);
      onDone?.();
      return;
    }

    // A request is already in flight for this slide: once it arrives, it will be applied if active.
    if (this.loadingSlideIds()[id]) {
      onDone?.();
      return;
    }

    this.loadingSlideIds.update((cur) => ({ ...cur, [id]: true }));
    this.logs.get(id).subscribe({
      next: (detail) => {
        const record: FoodLogCreated = { ...detail, advertencias: detail.advertencias ?? [] };
        this.detailsById.update((cur) => ({ ...cur, [id]: record }));
        this.loadingSlideIds.update((cur) => ({ ...cur, [id]: false }));
        if (this.activeId() === id) {
          this.store.set(record, null);
        }
        onDone?.();
      },
      error: () => {
        this.loadingSlideIds.update((cur) => ({ ...cur, [id]: false }));
        this.failedSlideIds.update((cur) => ({ ...cur, [id]: true }));
        if (makeActive && this.gallerySlides().length === 0) {
          this.notFound.set(true);
        }
        onDone?.();
      },
    });
  }

  /** Silently prefetches neighboring slide details so swiping feels instant. */
  private prefetchNeighbors(centerId: number): void {
    const slides = this.gallerySlides();
    const idx = slides.findIndex((s) => s.id === centerId);
    if (idx < 0) return;
    for (const neighbor of [slides[idx - 1], slides[idx + 1]]) {
      if (neighbor && !this.detailsById()[neighbor.id] && !this.loadingSlideIds()[neighbor.id]) {
        this.ensureSlideDetail(neighbor.id, false);
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(points: number[][], axis: 0 | 1): number {
  return points.reduce((acc, p) => acc + p[axis], 0) / points.length;
}
