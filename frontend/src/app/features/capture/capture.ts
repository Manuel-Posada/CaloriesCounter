import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, computed, effect, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { readFocal35mm } from '../../core/exif.util';
import { FoodLogService } from '../../core/food-log/food-log.service';
import { ResultStore } from '../../core/food-log/result.store';
import { compressImage } from '../../core/image.util';
import { TiltService } from '../../core/tilt.service';
import { PreferencesService } from '../../core/preferences.service';
import { LevelGauge } from './level-gauge';

type Step = 'presign' | 'upload' | 'infer';
type Mode = 'idle' | 'camera' | 'working';

const STEPS: { key: Step; label: string }[] = [
  { key: 'presign', label: 'Preparando' },
  { key: 'upload', label: 'Subiendo foto' },
  { key: 'infer', label: 'Analizando tu plato' },
];

/** Tiempo que hay que mantener el nivel antes de disparar solo. */
const HOLD_MS = 500;
/** Duración de cada paso de la cuenta atrás automática. */
const COUNTDOWN_STEP_MS = 300;
/** Frecuencia con la que se evalúa la inclinación. */
const WATCH_MS = 100;

@Component({
  selector: 'app-capture',
  imports: [LevelGauge],
  template: `
    <section class="page capture" [class.capture--camera]="mode() === 'camera'">
      @if (mode() === 'idle') {
        <header>
          <h1>¿Qué vas a comer?</h1>
          <p class="muted">
            Coloca el plato en la mesa y abre la cámara: te marcará en verde el momento exacto en el que
            está perfectamente cenital.
          </p>
        </header>

        <button type="button" class="btn btn--primary btn--xl btn--block" (click)="openCamera()">
          <span aria-hidden="true">📷</span> Abrir cámara guiada
        </button>

        <label class="btn btn--ghost btn--block">
          <input class="sr-only" type="file" accept="image/*" (change)="onFile($event)" />
          <span aria-hidden="true">🖼️</span> Elegir de la galería
        </label>

        @if (cameraFailed()) {
          <label class="btn btn--ghost btn--block">
            <input class="sr-only" type="file" accept="image/*" capture="environment" (change)="onFile($event)" />
            <span aria-hidden="true">📸</span> Usar la cámara del sistema
          </label>
        }

        @if (error()) {
          <p class="alert" role="alert">{{ error() }}</p>
        }

        <div class="card tips">
          <h2>Así el cálculo es exacto</h2>
          <ul>
            <li>Móvil <strong>paralelo a la mesa</strong>, a unos 30–40 cm del plato.</li>
            <li>Que se vea la mesa alrededor del plato.</li>
            <li>Luz abundante, sin sombras duras.</li>
          </ul>
        </div>
      } @else if (mode() === 'camera') {
        <div class="viewfinder">
          <video #video playsinline muted autoplay></video>

          <button type="button" class="close" aria-label="Cerrar la cámara" (click)="closeCamera()">✕</button>

          <div class="frame" aria-hidden="true">
            <span class="ring" [class.ring--ready]="isLevel()"></span>
          </div>

          @if (countdown() > 0) {
            <div class="countdown" aria-live="assertive">{{ countdown() }}</div>
          }

          @if (tilt.silent()) {
            <p class="notice">
              Este dispositivo no tiene sensor de inclinación. Mantén el móvil paralelo a la mesa y usa la guía.
            </p>
          }
        </div>

        <p class="tip">
          Sostén el móvil plano sobre el plato, a unos 30–40 cm, con la mesa visible alrededor.
        </p>

        <app-level-gauge
          [tilt]="tilt.tilt()"
          [beta]="tilt.beta()"
          [gamma]="tilt.gamma()"
          [bubble]="tilt.bubble()"
          [level]="isLevel()"
          [exitDeg]="prefs.levelExit()"
        />

        <button
          type="button"
          class="shutter"
          [class.shutter--ready]="canShoot()"
          [disabled]="!canShoot()"
          [attr.aria-label]="canShoot() ? 'Tomar foto' : 'Nivela el móvil para disparar'"
          (click)="shoot()"
        >
          <span class="shutter__dot"></span>
        </button>
      } @else {
        <div class="preview">
          @if (previewUrl()) {
            <img [src]="previewUrl()!" alt="Foto seleccionada" />
          }
          <div class="scan" aria-hidden="true"></div>
        </div>

        <ol class="steps card" aria-live="polite">
          @for (s of steps; track s.key; let i = $index) {
            <li [class.done]="i < activeIndex()" [class.active]="i === activeIndex()">
              <span class="dot">
                @if (i < activeIndex()) { ✓ } @else if (i === activeIndex()) { <span class="spinner"></span> }
              </span>
              <span class="label">{{ s.label }}</span>
              @if (s.key === 'upload' && i === activeIndex()) {
                <span class="pct">{{ progress() }}%</span>
              }
            </li>
          }
        </ol>

        @if (step() === 'upload') {
          <div class="bar" role="progressbar" [attr.aria-valuenow]="progress()" aria-valuemin="0" aria-valuemax="100">
            <div class="fill" [style.width.%]="progress()"></div>
          </div>
        }

        <!-- Skeleton del resultado que vendrá -->
        <div class="card sk">
          <div class="skeleton" style="height: 18px; width: 40%"></div>
          <div class="skeleton" style="height: 14px; margin-top: 12px"></div>
          <div class="skeleton" style="height: 14px; margin-top: 8px; width: 85%"></div>
        </div>
        <p class="muted center">Esto toma unos segundos…</p>
      }
    </section>
  `,
  styleUrl: './capture.scss',
})
export class Capture implements OnDestroy {
  private readonly logs = inject(FoodLogService);
  private readonly store = inject(ResultStore);
  private readonly router = inject(Router);
  protected readonly prefs = inject(PreferencesService);
  protected readonly tilt = inject(TiltService);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  private sub?: Subscription;
  private handedOver = false;
  private stream?: MediaStream;
  private watchTimer?: ReturnType<typeof setInterval>;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private stableSince = 0;
  private capturing = false;
  private audio?: AudioContext;

  protected readonly steps = STEPS;
  protected readonly mode = signal<Mode>('idle');
  protected readonly step = signal<Step>('presign');
  protected readonly progress = signal(0);
  protected readonly error = signal<string | null>(null);
  protected readonly cameraFailed = signal(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly isLevel = signal(false);
  protected readonly countdown = signal(0);
  protected readonly activeIndex = computed(() => STEPS.findIndex((s) => s.key === this.step()));
  protected readonly canShoot = computed(
    () => this.countdown() === 0 && (this.isLevel() || this.tilt.silent()),
  );

  constructor() {
    // El <video> sólo existe cuando `mode` pasa a 'camera': enganchamos el stream al aparecer.
    effect(() => {
      const el = this.videoRef()?.nativeElement;
      const stream = this.stream;
      if (!el || !stream) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      void el.play().catch(() => this.failCamera('No pudimos iniciar la vista previa de la cámara.'));
    });
  }

  async openCamera(): Promise<void> {
    this.error.set(null);
    this.cameraFailed.set(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      this.failCamera('Este navegador no permite abrir la cámara desde la web. Usa la galería o la cámara del sistema.');
      return;
    }

    // En iOS el permiso del sensor sólo se concede dentro del gesto del usuario, así que
    // se pide antes de cualquier otra espera.
    await this.tilt.enable();

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
    } catch (err) {
      this.failCamera(this.cameraMessage(err));
      return;
    }

    this.isLevel.set(false);
    this.countdown.set(0);
    this.capturing = false;
    this.stableSince = 0;
    this.mode.set('camera');
    this.watchTimer = setInterval(() => this.evaluateTilt(), WATCH_MS);
  }

  closeCamera(): void {
    this.cancelCountdown();
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.watchTimer = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.tilt.disable();
    this.isLevel.set(false);
    this.stableSince = 0;
    if (this.mode() === 'camera') this.mode.set('idle');
  }

  async shoot(): Promise<void> {
    if (this.capturing || this.mode() !== 'camera') return;

    const video = this.videoRef()?.nativeElement;
    if (!video || video.videoWidth === 0) {
      this.error.set('La cámara todavía no está lista. Espera un segundo e inténtalo otra vez.');
      return;
    }

    this.capturing = true;
    this.chime(1040);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      this.capturing = false;
      this.error.set('No pudimos capturar la foto. Inténtalo de nuevo.');
      return;
    }
    ctx.drawImage(video, 0, 0);

    const shot = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));

    this.closeCamera();
    this.capturing = false;

    if (!shot) {
      this.error.set('No pudimos capturar la foto. Inténtalo de nuevo.');
      return;
    }
    await this.analyze(shot);
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite volver a elegir la misma foto
    if (file) void this.analyze(file);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.closeCamera();
    this.revokePreview();
    void this.audio?.close();
  }

  /** Vigila la inclinación: verde con histéresis y auto-disparo si se mantiene nivelado. */
  private evaluateTilt(): void {
    if (this.mode() !== 'camera') return;

    const angle = this.tilt.tilt();
    if (angle === null) {
      this.isLevel.set(false);
      this.stableSince = 0;
      if (this.countdown() > 0) this.cancelCountdown();
      return;
    }

    const level = angle <= (this.isLevel() ? this.prefs.levelExit() : this.prefs.levelEnter());
    if (level && !this.isLevel()) this.chime(720);
    if (!level) {
      this.stableSince = 0;
      // Si se mueve durante la cuenta atrás se aborta: la foto saldría torcida.
      if (this.countdown() > 0) this.cancelCountdown();
    }
    this.isLevel.set(level);

    if (!level || this.countdown() > 0) return;
    if (this.stableSince === 0) this.stableSince = Date.now();
    if (Date.now() - this.stableSince >= HOLD_MS) this.startCountdown();
  }

  private startCountdown(): void {
    if (this.capturing || this.countdownTimer) return;
    this.capturing = true;
    this.countdown.set(3);
    this.chime(880);

    this.countdownTimer = setInterval(() => {
      const next = this.countdown() - 1;
      if (next > 0) {
        this.countdown.set(next);
        return;
      }
      this.cancelCountdown();
      void this.shoot();
    }, COUNTDOWN_STEP_MS);
  }

  private cancelCountdown(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = undefined;
    this.countdown.set(0);
    this.capturing = false;
  }

  private failCamera(message: string): void {
    this.cameraFailed.set(true);
    this.error.set(message);
    this.closeCamera();
  }

  private cameraMessage(err: unknown): string {
    switch ((err as DOMException)?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'No diste permiso para usar la cámara. Actívalo en los ajustes del navegador o usa la galería.';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No encontramos ninguna cámara disponible en este dispositivo.';
      case 'NotReadableError':
        return 'Otra aplicación está usando la cámara. Ciérrala e inténtalo de nuevo.';
      default:
        return 'No pudimos abrir la cámara. Prueba con la galería.';
    }
  }

  private async analyze(source: Blob): Promise<void> {
    this.error.set(null);

    let blob: Blob;
    let focal35: number | null = null;
    try {
      // El EXIF se lee del fichero original: `compressImage` re-encodea y lo borra.
      [blob, focal35] = await Promise.all([
        compressImage(source),
        source instanceof File ? readFocal35mm(source) : Promise.resolve(null),
      ]);
    } catch {
      this.error.set('No pudimos leer esa imagen. Prueba con otra foto (JPG, PNG o WebP).');
      this.mode.set('idle');
      return;
    }

    this.revokePreview();
    this.previewUrl.set(URL.createObjectURL(blob));
    this.step.set('presign');
    this.progress.set(0);
    this.mode.set('working');

    this.sub = this.logs.analyze(blob, focal35).subscribe({
      next: (e) => {
        if (e.step === 'done') {
          this.store.set(e.result, this.previewUrl());
          this.handedOver = true; // el store es ahora dueño del object URL
          this.router.navigate(['/result']);
          return;
        }
        this.step.set(e.step);
        if (e.step === 'upload') this.progress.set(e.progress);
      },
      error: (err: HttpErrorResponse) => {
        this.mode.set('idle');
        this.error.set(this.messageFor(err));
        this.revokePreview();
      },
    });
  }

  private messageFor(err: HttpErrorResponse): string {
    switch (err.status) {
      case 0:
        return 'Sin conexión o la subida fue bloqueada. Revisa tu red e inténtalo de nuevo.';
      case 422:
        return 'No detectamos alimentos en la foto. Prueba con más luz o un ángulo más cercano.';
      case 502:
        return 'El análisis no está disponible ahora mismo. Inténtalo en un minuto.';
      default:
        return 'Algo salió mal. Inténtalo de nuevo.';
    }
  }

  /**
   * Pitido corto. Con el móvil plano el usuario no ve la pantalla, así que el sonido es
   * la única confirmación fiable (iOS no soporta navigator.vibrate).
   */
  private chime(frequency: number): void {
    try {
      const Ctx = window.AudioContext;
      if (!Ctx) return;
      this.audio ??= new Ctx();
      const ctx = this.audio;
      if (ctx.state === 'suspended') void ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch {
      // Sin audio disponible: el indicador visual sigue funcionando.
    }
  }

  private revokePreview(): void {
    const url = this.previewUrl();
    if (url && !this.handedOver) URL.revokeObjectURL(url);
    this.previewUrl.set(null);
  }
}
