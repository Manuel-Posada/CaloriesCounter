import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FoodLogService } from '../../core/food-log/food-log.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { FoodContour, FoodLog } from '../../core/models';
import { TILT_WARN_DEG } from '../../core/tilt.service';

@Component({
  selector: 'app-history',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <section class="page">
      <h1>{{ i18n.t('history.title') }}</h1>
      <p class="muted">{{ i18n.t('history.retention') }}</p>

      @if (loading() && items().length === 0) {
        @for (n of [1, 2, 3]; track n) {
          <div class="card row"><div class="skeleton thumb"></div><div class="grow">
            <div class="skeleton" style="height: 16px; width: 55%"></div>
            <div class="skeleton" style="height: 12px; width: 80%; margin-top: 10px"></div>
          </div></div>
        }
      }

      @if (error(); as key) {
        <p class="alert" role="alert">
          {{ i18n.t(key) }}
          <button type="button" class="link" (click)="load()">{{ i18n.t('history.retry') }}</button>
        </p>
      }

      @if (!loading() && !error() && items().length === 0) {
        <div class="card empty">
          <p>{{ i18n.t('history.empty') }}</p>
          <a class="btn btn--primary" routerLink="/">{{ i18n.t('history.emptyCta') }}</a>
        </div>
      }

      <ul class="list">
        @for (log of items(); track log.id) {
          <li [style.--i]="$index % 10">
            @if (hasImage(log)) {
              <!-- Reciente: imagen almacenada en R2. Toda la tarjeta abre el detalle. -->
              <a class="card row" [routerLink]="['/result', log.id]" [attr.aria-label]="i18n.t('history.openDetail')">
                <figure class="thumb-wrap">
                  <img
                    class="thumb"
                    [class.thumb--loaded]="!!size(log.id)"
                    [src]="log.imagen_url!"
                    [attr.alt]="i18n.t('history.photoAlt')"
                    loading="lazy"
                    (load)="onThumbLoad(log.id, $event)"
                    (error)="onImageError(log.id)"
                  />
                  @if (size(log.id); as s) {
                    @if (log.contornos.length) {
                      <svg class="thumb-overlay" [attr.viewBox]="'0 0 ' + s.w + ' ' + s.h"
                           preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                        @for (c of log.contornos; track $index) {
                          @if (c.poligono.length) {
                            <polygon [attr.points]="points(c, s)" />
                          }
                        }
                      </svg>
                    }
                  }
                </figure>
                <div class="grow">
                  <div class="top">
                    <strong>{{ log.calorias_totales | number: '1.0-0' : i18n.dateLocale() }} kcal</strong>
                    <span class="right">
                      <time class="muted">{{ log.fecha_hora | date: i18n.shortDate() : undefined : i18n.dateLocale() }}</time>
                      @if (tilted(log)) {
                        <span class="chip chip--warn" [attr.title]="i18n.t('history.tilted')">📐 {{ log.angulo_camara_deg | number: '1.0-0' : i18n.dateLocale() }}°</span>
                      }
                    </span>
                  </div>
                  <p class="macros">{{ macros(log) }}</p>
                  @if (log.consejo_nutricional) { <p class="tip">{{ log.consejo_nutricional }}</p> }
                </div>
                <span class="chev" aria-hidden="true">›</span>
              </a>
            } @else {
              <!-- Antigua: solo texto y datos -->
              <a class="card text-only" [routerLink]="['/result', log.id]" [attr.aria-label]="i18n.t('history.openDetail')">
                <div class="top">
                  <time class="muted">{{ log.fecha_hora | date: i18n.longDate() : undefined : i18n.dateLocale() }}</time>
                  <span class="right">
                    @if (tilted(log)) {
                      <span class="chip chip--warn" [attr.title]="i18n.t('history.tilted')">📐 {{ log.angulo_camara_deg | number: '1.0-0' : i18n.dateLocale() }}°</span>
                    }
                    <span class="chip">{{ i18n.t('history.noPhoto') }}</span>
                  </span>
                </div>
                <div class="figures">
                  <div class="big"><strong>{{ log.calorias_totales | number: '1.0-0' }}</strong><span>kcal</span></div>
                  <dl>
                    <div><dt>{{ i18n.t('result.protein') }}</dt><dd>{{ log.macronutrientes.proteinas_g | number: '1.0-0' }} g</dd></div>
                    <div><dt>{{ i18n.t('result.carbs') }}</dt><dd>{{ log.macronutrientes.carbohidratos_g | number: '1.0-0' }} g</dd></div>
                    <div><dt>{{ i18n.t('result.fat') }}</dt><dd>{{ log.macronutrientes.grasas_g | number: '1.0-0' }} g</dd></div>
                    <div><dt>{{ i18n.t('result.volume') }}</dt><dd>{{ log.volumen_estimado | number: '1.0-0' }} cm³</dd></div>
                  </dl>
                </div>
                @if (log.consejo_nutricional) { <p class="tip">{{ log.consejo_nutricional }}</p> }
              </a>
            }
          </li>
        }
      </ul>

      @if (hasMore()) {
        <button type="button" class="btn btn--ghost btn--block" [disabled]="loading()" (click)="load()">
          @if (loading()) { <span class="spinner"></span> } {{ i18n.t('history.loadMore') }}
        </button>
      }
    </section>
  `,
  styleUrl: './history.scss',
})
export class History implements OnInit {
  private readonly logs = inject(FoodLogService);
  protected readonly i18n = inject(I18nService);

  protected readonly items = signal<FoodLog[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<MessageKey | null>(null);
  protected readonly hasMore = signal(false);
  /** IDs cuya imagen falló al cargar (p. ej. borrada entre el listado y la vista). */
  protected readonly failed = new Set<number | string>();
  /** Tamaño natural de cada miniatura, para alinear el contorno con la imagen recortada. */
  private readonly sizes = signal<Record<number, { w: number; h: number }>>({});
  private page = 1;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.logs.list(this.page).subscribe({
      next: (res) => {
        this.items.update((cur) => [...cur, ...res.results]);
        this.hasMore.set(!!res.next);
        this.page++;
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set('history.loadingError');
      },
    });
  }

  protected hasImage(log: FoodLog): boolean {
    return !!log.imagen_url && !this.failed.has(log.id);
  }

  /** Foto tomada con la cámara torcida: se marca con el mismo umbral que en el resultado. */
  protected tilted(log: FoodLog): boolean {
    const deg = log.angulo_camara_deg;
    return deg != null && deg > TILT_WARN_DEG;
  }

  protected onThumbLoad(id: number, event: Event): void {
    const img = event.target as HTMLImageElement;
    const w = img.naturalWidth || 1;
    const h = img.naturalHeight || 1;
    this.sizes.update((sizes) => ({ ...sizes, [id]: { w, h } }));
  }

  protected size(id: number): { w: number; h: number } | undefined {
    return this.sizes()[id];
  }

  /** Pasa el polígono normalizado a coordenadas de la imagen (el SVG usa su viewBox). */
  protected points(contour: FoodContour, size: { w: number; h: number }): string {
    return contour.poligono
      .map(([x, y]) => `${(x * size.w).toFixed(1)},${(y * size.h).toFixed(1)}`)
      .join(' ');
  }

  protected macros(log: FoodLog): string {
    const m = log.macronutrientes;
    return this.i18n.t('history.macros', {
      p: Math.round(m.proteinas_g),
      c: Math.round(m.carbohidratos_g),
      f: Math.round(m.grasas_g),
    });
  }

  protected onImageError(logId: string | number): void {
    this.failed.add(logId);
    this.currentReference();
  }

  /** Nueva referencia del array para forzar la reactividad (`failed` es un Set). */
  private currentReference(): void {
    const current = this.items() || [];
    this.items.set([...current]);
  }
}

