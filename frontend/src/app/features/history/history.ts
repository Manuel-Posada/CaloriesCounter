import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FoodLogService } from '../../core/food-log/food-log.service';
import { FoodContour, FoodLog } from '../../core/models';
import { TILT_WARN_DEG } from '../../core/tilt.service';

@Component({
  selector: 'app-history',
  imports: [DatePipe, DecimalPipe, RouterLink],
  template: `
    <section class="page">
      <h1>Historial</h1>
      <p class="muted">Las fotos se conservan 3 días; los datos, 1 mes.</p>

      @if (loading() && items().length === 0) {
        @for (n of [1, 2, 3]; track n) {
          <div class="card row"><div class="skeleton thumb"></div><div class="grow">
            <div class="skeleton" style="height: 16px; width: 55%"></div>
            <div class="skeleton" style="height: 12px; width: 80%; margin-top: 10px"></div>
          </div></div>
        }
      }

      @if (error()) {
        <p class="alert" role="alert">{{ error() }}
          <button type="button" class="link" (click)="load()">Reintentar</button></p>
      }

      @if (!loading() && !error() && items().length === 0) {
        <div class="card empty">
          <p>Aún no has registrado comidas.</p>
          <a class="btn btn--primary" routerLink="/">Analizar mi primer plato</a>
        </div>
      }

      <ul class="list">
        @for (log of items(); track log.id) {
          <li>
            @if (hasImage(log)) {
              <!-- Reciente: imagen almacenada en R2 -->
              <article class="card row">
                <figure class="thumb-wrap">
                  <img class="thumb" [src]="log.imagen_url!" alt="Foto de la comida" loading="lazy"
                       (load)="onThumbLoad(log.id, $event)" (error)="onImageError(log.id)" />
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
                    <strong>{{ log.calorias_totales | number: '1.0-0' }} kcal</strong>
                    <span class="right">
                      <time class="muted">{{ log.fecha_hora | date: "d MMM, HH:mm" }}</time>
                      @if (tilted(log)) {
                        <span class="chip chip--warn" title="La foto no era cenital">📐 {{ log.angulo_camara_deg | number: '1.0-0' }}°</span>
                      }
                    </span>
                  </div>
                  <p class="macros">{{ macros(log) }}</p>
                  @if (log.consejo_nutricional) { <p class="tip">{{ log.consejo_nutricional }}</p> }
                </div>
              </article>
            } @else {
              <!-- Antigua: solo texto y datos -->
              <article class="card text-only">
                <div class="top">
                  <time class="muted">{{ log.fecha_hora | date: "EEEE d MMM, HH:mm" }}</time>
                  <span class="right">
                    @if (tilted(log)) {
                      <span class="chip chip--warn" title="La foto no era cenital">📐 {{ log.angulo_camara_deg | number: '1.0-0' }}°</span>
                    }
                    <span class="chip">Sin foto</span>
                  </span>
                </div>
                <div class="figures">
                  <div class="big"><strong>{{ log.calorias_totales | number: '1.0-0' }}</strong><span>kcal</span></div>
                  <dl>
                    <div><dt>Prot.</dt><dd>{{ log.macronutrientes.proteinas_g | number: '1.0-0' }} g</dd></div>
                    <div><dt>Carb.</dt><dd>{{ log.macronutrientes.carbohidratos_g | number: '1.0-0' }} g</dd></div>
                    <div><dt>Grasa</dt><dd>{{ log.macronutrientes.grasas_g | number: '1.0-0' }} g</dd></div>
                    <div><dt>Vol.</dt><dd>{{ log.volumen_estimado | number: '1.0-0' }} cm³</dd></div>
                  </dl>
                </div>
                @if (log.consejo_nutricional) { <p class="tip">{{ log.consejo_nutricional }}</p> }
              </article>
            }
          </li>
        }
      </ul>

      @if (hasMore()) {
        <button type="button" class="btn btn--ghost btn--block" [disabled]="loading()" (click)="load()">
          @if (loading()) { <span class="spinner"></span> } Cargar más
        </button>
      }
    </section>
  `,
  styleUrl: './history.scss',
})
export class History implements OnInit {
  private readonly logs = inject(FoodLogService);

  protected readonly items = signal<FoodLog[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
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
        this.error.set('No pudimos cargar tu historial.');
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
    if (!img.naturalWidth || !img.naturalHeight) return;
    this.sizes.update((sizes) => ({ ...sizes, [id]: { w: img.naturalWidth, h: img.naturalHeight } }));
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
    return `P ${Math.round(m.proteinas_g)} g · C ${Math.round(m.carbohidratos_g)} g · G ${Math.round(m.grasas_g)} g`;
  }

  protected onImageError(logId: string | number): void {
    this.failed.add(logId);
    const current = this.items() || [];
    this.items.set([...current]); // nueva referencia para forzar la reactividad
  }
}

