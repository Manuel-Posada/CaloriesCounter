import { HttpErrorResponse } from '@angular/common/http';
import { Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { readFocal35mm } from '../../core/exif.util';
import { FoodLogService } from '../../core/food-log/food-log.service';
import { ResultStore } from '../../core/food-log/result.store';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { compressImage } from '../../core/image.util';
import { TiltService } from '../../core/tilt.service';
import { PreferencesService } from '../../core/preferences.service';

type Step = 'presign' | 'upload' | 'infer';
type Mode = 'idle' | 'camera' | 'working';

const STEPS: { key: Step; labelKey: MessageKey }[] = [
  { key: 'presign', labelKey: 'capture.stepPresign' },
  { key: 'upload', labelKey: 'capture.stepUpload' },
  { key: 'infer', labelKey: 'capture.stepInfer' },
];

const HOME_TITLE_KEYS: readonly MessageKey[] = [
  'capture.title1',
  'capture.title2',
  'capture.title3',
  'capture.title4',
];

/** Duración de cada paso de la cuenta regresiva (1 segundo × 3 pasos = 3 segundos). */
const COUNTDOWN_STEP_MS = 1000;
/** Tiempo que hay que mantener el nivel antes de disparar solo (si el auto-disparo está activo). */
const HOLD_MS = 500;
/** Tiempo que permanece visible un aviso superpuesto en cámara antes de ocultarse. */
const NOTICE_TIMEOUT_MS = 3500;
/** Tras este tiempo analizando se avisa de que el backend puede estar despertando. */
const SLOW_HINT_MS = 8000;
/** Separación máxima de los arcos cuando un eje está muy desviado. */
const ARC_SPREAD_PX = 28;
/** Grados de desviación en un eje que abren del todo su lado del aro. */
const ARC_FULL_DEG = 30;

@Component({
  selector: 'app-capture',
  imports: [],
  template: `
    <section
      class="page capture"
      [class.capture--idle]="mode() === 'idle'"
      [class.capture--camera]="mode() === 'camera'"
      [style.--icon-rot]="deviceOrientation() + 'deg'"
    >
      @if (mode() === 'idle') {
        <div class="idle-stage">
          <h1 class="sr-only">{{ dynamicTitle() }}</h1>

          <svg class="frame frame--open" viewBox="0 0 200 200" aria-hidden="true">
            <path class="arc arc--tl" d="M 4 100 A 96 96 0 0 1 100 4" />
            <path class="arc arc--tr" d="M 100 4 A 96 96 0 0 1 196 100" />
            <path class="arc arc--br" d="M 196 100 A 96 96 0 0 1 100 196" />
            <path class="arc arc--bl" d="M 100 196 A 96 96 0 0 1 4 100" />
          </svg>

          <button type="button" class="idle-trigger" [disabled]="isOpeningCamera()" (click)="openCamera()">
            <span class="idle-trigger__icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
            </span>
            <span class="sr-only">{{ i18n.t('capture.openCamera') }}.</span>
            <span class="idle-trigger__label">{{ dynamicTitle() }}</span>
          </button>

          @if (error(); as key) {
            <p class="idle-alert" role="alert">{{ i18n.t(key) }}</p>
          }

          @if (cameraFailed()) {
            <label class="idle-fallback">
              <input
                class="sr-only"
                type="file"
                accept="image/*"
                capture="environment"
                [disabled]="isOpeningCamera()"
                (change)="onFile($event)"
              />
              <span aria-hidden="true">📸</span> {{ i18n.t('capture.systemCamera') }}
            </label>
          }

          <label class="gallery-btn gallery-btn--idle">
            <input
              class="sr-only"
              type="file"
              accept="image/*"
              [disabled]="isOpeningCamera()"
              [attr.aria-label]="i18n.t('capture.gallery')"
              (change)="onFile($event)"
            />
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
          </label>
        </div>
      } @else if (mode() === 'camera') {
        <div class="viewfinder">
          <video #video playsinline muted autoplay></video>

          <button
            type="button"
            class="close"
            [attr.aria-label]="i18n.t('capture.closeCamera')"
            (click)="closeCamera()"
          >
            <span class="close__icon" aria-hidden="true">✕</span>
          </button>

          <svg
            class="frame"
            viewBox="0 0 200 200"
            [class.frame--ready]="isLevel()"
            [style.--up]="gaps().up"
            [style.--down]="gaps().down"
            [style.--left]="gaps().left"
            [style.--right]="gaps().right"
            aria-hidden="true"
          >
            <path class="arc arc--tl" d="M 4 100 A 96 96 0 0 1 100 4" />
            <path class="arc arc--tr" d="M 100 4 A 96 96 0 0 1 196 100" />
            <path class="arc arc--br" d="M 196 100 A 96 96 0 0 1 100 196" />
            <path class="arc arc--bl" d="M 100 196 A 96 96 0 0 1 4 100" />
          </svg>

          @if (isCounting() && countdown() > 0) {
            <div class="countdown" aria-live="assertive">
              <span class="countdown__num">{{ countdown() }}</span>
            </div>
          }

          @if (cameraNotice(); as notice) {
            <p class="notice notice--alert" role="status" aria-live="polite">
              {{ i18n.t(notice.key, notice.deg !== undefined ? { deg: notice.deg } : undefined) }}
            </p>
          } @else if (tilt.silent()) {
            <p class="notice">{{ i18n.t('capture.noSensor') }}</p>
          }

          <div class="camera-bar">
            <span class="camera-bar__spacer" aria-hidden="true"></span>

            <div class="shutter-box">
              <button
                type="button"
                class="shutter"
                [class.shutter--ready]="canShoot()"
                [class.shutter--counting]="isCounting()"
                [disabled]="isCounting()"
                [attr.aria-disabled]="!canShoot() ? 'true' : null"
                [attr.aria-label]="canShoot() ? i18n.t('capture.shoot') : i18n.t('capture.shootDisabled')"
                (click)="triggerCapture()"
              >
                @if (prefs.bubbleLevel()) {
                  <span class="shutter__cross" aria-hidden="true"></span>
                }
                <span class="shutter__bubble" [style.transform]="bubbleStyle()"></span>
              </button>

              @if (prefs.bubbleLevel() && tilt.tilt() !== null) {
                <div class="shutter-readout" [class.shutter-readout--ok]="isLevel()" aria-hidden="true">
                  <strong>{{ levelDegrees() }}°</strong>
                  @if (levelHint(); as hint) {
                    <span>{{ i18n.t(hint) }}</span>
                  }
                </div>
              }
            </div>

            <label class="gallery-btn">
              <input
                class="sr-only"
                type="file"
                accept="image/*"
                [attr.aria-label]="i18n.t('capture.gallery')"
                (change)="onFile($event)"
              />
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </label>
          </div>
        </div>
      } @else {
        <div class="preview">
          @if (previewUrl()) {
            <img [src]="previewUrl()!" [attr.alt]="i18n.t('capture.previewAlt')" />
          }
          <div class="scan" aria-hidden="true"></div>
        </div>

        <ol class="steps card" aria-live="polite">
          @for (s of steps; track s.key; let i = $index) {
            <li [class.done]="i < activeIndex()" [class.active]="i === activeIndex()">
              <span class="dot">
                @if (i < activeIndex()) { ✓ } @else if (i === activeIndex()) { <span class="spinner"></span> }
              </span>
              <span class="label">{{ i18n.t(s.labelKey) }}</span>
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

        @if (slowServer()) {
          <p class="note slow" role="status">{{ i18n.t('capture.slowServer') }}</p>
        }

        <!-- Skeleton del resultado que vendrá -->
        <div class="card sk">
          <div class="skeleton" style="height: 18px; width: 40%"></div>
          <div class="skeleton" style="height: 14px; margin-top: 12px"></div>
          <div class="skeleton" style="height: 14px; margin-top: 8px; width: 85%"></div>
        </div>
        <p class="muted center">{{ i18n.t('capture.working') }}</p>
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
  protected readonly i18n = inject(I18nService);

  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('video');

  private sub?: Subscription;
  private handedOver = false;
  private destroyed = false;
  private readonly stream = signal<MediaStream | undefined>(undefined);
  private holdTimer?: ReturnType<typeof setTimeout>;
  private countdownTimer?: ReturnType<typeof setInterval>;
  private noticeTimeout?: ReturnType<typeof setTimeout>;
  private slowTimer?: ReturnType<typeof setTimeout>;
  private capturing = false;
  private audio?: AudioContext;

  private readonly titleIndex = Math.floor(Math.random() * HOME_TITLE_KEYS.length);
  protected readonly dynamicTitle = computed(() => this.i18n.t(HOME_TITLE_KEYS[this.titleIndex]));
  protected readonly steps = STEPS;
  protected readonly mode = signal<Mode>('idle');
  protected readonly isOpeningCamera = signal(false);
  protected readonly step = signal<Step>('presign');
  protected readonly progress = signal(0);
  protected readonly error = signal<MessageKey | null>(null);
  protected readonly cameraFailed = signal(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly isLevel = signal(false);
  protected readonly isCounting = signal(false);
  protected readonly countdown = signal(0);
  /** Ángulo de orientación física de la pantalla (0, 90, -90) para contrarrotar los iconos. */
  protected readonly deviceOrientation = signal<number>(0);
  /** El análisis tarda más de lo normal (backend despertando de un arranque en frío). */
  protected readonly slowServer = signal(false);
  protected readonly cameraNotice = signal<{ key: MessageKey; deg?: number } | null>(null);
  protected readonly activeIndex = computed(() => STEPS.findIndex((s) => s.key === this.step()));
  protected readonly canShoot = computed(
    () => !this.isCounting() && (this.isLevel() || this.tilt.silent()),
  );

  /**
   * Separación de cada lado del aro (0..28 px) según el eje que esté desviado: el arco se
   * abre por el lado bajo, que es el que hay que levantar. `bubble` ya viene rotado con la
   * pantalla, y la rampa arranca en `levelEnter()` para evitar saltos bruscos al nivelar.
   */
  protected readonly gaps = computed(() => {
    const closed = { up: '0px', down: '0px', left: '0px', right: '0px' };
    const tilt = this.tilt.tilt();
    if (this.mode() !== 'camera' || this.isLevel() || tilt === null) return closed;

    const enter = this.prefs.levelEnter();
    const ramp = Math.min(1, Math.max(0, (tilt - enter) / (ARC_FULL_DEG - enter)));
    const { x, y } = this.tilt.bubble();
    const open = (deg: number) => {
      const axisRatio = Math.min(1, Math.max(0, deg) / ARC_FULL_DEG);
      return `${(ARC_SPREAD_PX * axisRatio * ramp).toFixed(1)}px`;
    };

    // bubble.y < 0: el borde superior está alto (el bajo es el de abajo), y viceversa.
    return { up: open(y), down: open(-y), left: open(x), right: open(-x) };
  });

  /**
   * Burbuja del obturador: se desplaza hacia el lado alto y crece al centrarse, así que el
   * propio botón hace de nivel sin ocupar más pantalla.
   */
  protected readonly bubbleStyle = computed(() => {
    const tilt = this.tilt.tilt();
    const { x, y } = this.tilt.bubble();
    const magnitude = Math.hypot(x, y);
    const k = Math.min(1, magnitude / 25);
    const angle = magnitude > 0 ? Math.atan2(y, x) : 0;
    const px = Math.cos(angle) * k * 9;
    const py = Math.sin(angle) * k * 9;
    // 1.2 cuando está centrada; 0.7 cuando va muy torcida (o sin lectura).
    const scale = tilt === null ? 0.85 : 1.2 - 0.5 * Math.min(1, tilt / 20);
    return `translate(-50%, -50%) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) scale(${scale.toFixed(2)})`;
  });

  protected readonly levelDegrees = computed(() => Math.round(this.tilt.tilt() ?? 0));

  /** Instrucción de la guía clásica en coordenadas de pantalla: se corrige primero el eje más desviado. */
  protected readonly levelHint = computed<MessageKey | null>(() => {
    if (this.tilt.tilt() === null) return null;
    if (this.isLevel()) return 'gauge.perfect';
    const { x, y } = this.tilt.bubble();
    if (Math.abs(y) >= Math.abs(x)) {
      return y < 0 ? 'gauge.lowerBottom' : 'gauge.lowerTop';
    }
    return x < 0 ? 'gauge.lowerRight' : 'gauge.lowerLeft';
  });

  private readonly onOrientationChange = (): void => {
    this.deviceOrientation.set(this.readDeviceOrientation());
  };

  constructor() {
    this.deviceOrientation.set(this.readDeviceOrientation());
    window.addEventListener('orientationchange', this.onOrientationChange);
    // `orientationchange` llega antes de que el viewport cambie de tamaño: `resize` confirma
    // si la página terminó en horizontal (y por tanto ya está girada).
    window.addEventListener('resize', this.onOrientationChange);
    screen.orientation?.addEventListener?.('change', this.onOrientationChange);

    // El <video> sólo existe cuando `mode` pasa a 'camera': enganchamos el stream reactivamente.
    effect(() => {
      const el = this.videoRef()?.nativeElement;
      const stream = this.stream();
      if (!el || !stream) return;
      if (el.srcObject !== stream) el.srcObject = stream;
      void el.play().catch(() => this.failCamera('capture.cameraPreviewError'));
    });

    // Bloquea el scroll y el rubber-banding (overscroll) del body en iOS Safari mientras la cámara está activa.
    effect((onCleanup) => {
      const active = this.mode() === 'camera';
      document.body.classList.toggle('camera-open', active);
      document.body.style.overflow = active ? 'hidden' : '';
      document.body.style.overscrollBehavior = active ? 'none' : '';
      onCleanup(() => {
        document.body.classList.remove('camera-open');
        document.body.style.overflow = '';
        document.body.style.overscrollBehavior = '';
      });
    });

    // Deriva reactivamente el estado de nivel con histéresis a partir de las señales de TiltService (sin setInterval).
    effect(() => {
      if (this.mode() !== 'camera') {
        this.clearHoldTimer();
        return;
      }

      const angle = this.tilt.tilt();
      const enter = this.prefs.levelEnter();
      const exit = this.prefs.levelExit();
      const autoShoot = this.prefs.autoShoot();

      const wasLevel = untracked(() => this.isLevel());
      const isCounting = untracked(() => this.isCounting());

      if (angle === null) {
        this.clearHoldTimer();
        if (wasLevel) this.isLevel.set(false);
        if (isCounting) this.cancelCountdown(true);
        return;
      }

      const level = angle <= (wasLevel ? exit : enter);
      if (level !== wasLevel) {
        this.isLevel.set(level);
        if (level) {
          this.chime(720);
        }
      }

      if (!level) {
        this.clearHoldTimer();
        if (isCounting) {
          // Si se mueve y supera la histéresis durante los 3 s, se aborta de inmediato.
          this.cancelCountdown(true);
        }
        return;
      }

      // Disparo automático (opcional): nivelado y estable durante HOLD_MS.
      if (autoShoot && !isCounting && !this.capturing) {
        this.holdTimer ??= setTimeout(() => {
          this.holdTimer = undefined;
          this.startCountdown();
        }, HOLD_MS);
      } else if (!autoShoot) {
        this.clearHoldTimer();
      }
    });
  }

  async openCamera(): Promise<void> {
    if (this.isOpeningCamera() || this.mode() !== 'idle') return;

    this.isOpeningCamera.set(true);
    // Debe hacerse dentro del gesto del usuario: después de los `await` se pierde la activación
    // transitoria y el navegador rechazaría la pantalla completa (necesaria para bloquear el giro).
    this.enterImmersiveCamera();
    this.error.set(null);
    this.cameraFailed.set(false);

    // En iOS Safari el AudioContext debe crearse/reanudarse de forma síncrona en el click.
    this.unlockAudio();

    if (!navigator.mediaDevices?.getUserMedia) {
      this.isOpeningCamera.set(false);
      this.failCamera('capture.noCameraApi');
      return;
    }

    try {
      // En iOS el permiso del sensor sólo se concede dentro del gesto del usuario.
      await this.tilt.enable();
      if (this.destroyed || this.mode() !== 'idle') {
        this.tilt.disable();
        this.exitImmersiveCamera();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });

      if (this.destroyed || this.mode() !== 'idle') {
        stream.getTracks().forEach((track) => track.stop());
        this.tilt.disable();
        this.exitImmersiveCamera();
        return;
      }

      this.stopStream();
      this.stream.set(stream);
    } catch (err) {
      if (!this.destroyed && this.mode() === 'idle') {
        this.failCamera(this.cameraMessage(err));
      }
      return;
    } finally {
      this.isOpeningCamera.set(false);
    }

    this.isLevel.set(false);
    this.isCounting.set(false);
    this.countdown.set(0);
    this.clearHoldTimer();
    this.clearNotice();
    this.capturing = false;
    this.mode.set('camera');
  }

  closeCamera(resetMode = true): void {
    this.exitImmersiveCamera();
    this.cancelCountdown();
    this.clearNotice();
    this.clearHoldTimer();
    this.stopStream();
    this.tilt.disable();
    this.isLevel.set(false);
    if (resetMode && this.mode() === 'camera') this.mode.set('idle');
  }

  /**
   * Acción manual del obturador:
   * - Si el dispositivo no está nivelado (> umbral cenital, 8° por defecto), muestra aviso y no inicia cuenta.
   * - Si está nivelado (o el dispositivo no tiene sensor), inicia la cuenta regresiva de 3 segundos.
   */
  triggerCapture(): void {
    if (this.mode() !== 'camera' || this.isCounting() || this.capturing) return;

    if (!this.isLevel() && !this.tilt.silent()) {
      this.chime(360);
      this.showNotice('capture.levelRequired', this.prefs.levelEnter());
      return;
    }

    this.clearNotice();
    this.startCountdown();
  }

  async shoot(): Promise<void> {
    if (this.capturing || this.mode() !== 'camera') return;

    const video = this.videoRef()?.nativeElement;
    if (!video || video.videoWidth === 0) {
      this.error.set('capture.notReady');
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
      this.error.set('capture.shotFailed');
      return;
    }
    ctx.drawImage(video, 0, 0);

    // Pasamos a 'working' y liberamos la cámara antes de codificar el JPEG.
    this.closeCamera(false);
    this.step.set('presign');
    this.progress.set(0);
    this.mode.set('working');

    const shot = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    this.capturing = false;

    if (this.destroyed || this.mode() !== 'working') return;

    if (!shot) {
      this.mode.set('idle');
      this.error.set('capture.shotFailed');
      return;
    }
    await this.analyze(shot);
  }

  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite volver a elegir la misma foto
    if (file && !this.isOpeningCamera()) {
      if (this.mode() === 'camera') this.closeCamera(false);
      void this.analyze(file);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    window.removeEventListener('orientationchange', this.onOrientationChange);
    window.removeEventListener('resize', this.onOrientationChange);
    screen.orientation?.removeEventListener?.('change', this.onOrientationChange);
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.clearSlowHint();
    this.closeCamera(false);
    this.revokePreview();
    void this.audio?.close();
  }

  /**
   * Ángulo para contrarrotar los iconos. Solo se aplica cuando la página **no** ha girado con
   * el móvil (p. ej. si algún día se bloquea la orientación): si el navegador ya puso la
   * interfaz en horizontal, los iconos deben quedarse como están.
   */
  private readDeviceOrientation(): number {
    const raw =
      typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number'
        ? screen.orientation.angle
        : typeof (window as { orientation?: number }).orientation === 'number'
          ? Number((window as { orientation?: number }).orientation)
          : 0;
    const norm = ((raw % 360) + 360) % 360;
    const angle = norm === 90 ? 90 : norm === 270 ? -90 : norm === 180 ? 180 : 0;
    const pageLandscape = typeof window !== 'undefined' && window.innerWidth > window.innerHeight;
    return pageLandscape ? 0 : angle;
  }

  /**
   * Pantalla completa + bloqueo vertical al abrir la cámara. Chrome solo permite
   * `screen.orientation.lock` en pantalla completa, así que se pide primero sobre la raíz
   * (dentro del gesto del usuario). En iOS Safari no existe ninguno de los dos: se ignora.
   */
  private enterImmersiveCamera(): void {
    const lock = (): void => {
      try {
        const request = (screen.orientation as ScreenOrientation & {
          lock?: (orientation: string) => Promise<void>;
        })?.lock?.('portrait');
        // `lock()` puede rechazar (sin soporte o sin activación): no debe quedar sin capturar.
        if (request && typeof request.catch === 'function') {
          void request.catch(() => undefined);
        }
      } catch {
        // Navegador sin bloqueo de orientación.
      }
    };
    const root = document.documentElement as HTMLElement & {
      requestFullscreen?: (options?: { navigationUI?: string }) => Promise<void>;
    };
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen({ navigationUI: 'hide' }).then(lock, lock);
    } else {
      lock();
    }
  }

  private exitImmersiveCamera(): void {
    try {
      (screen.orientation as ScreenOrientation & { unlock?: () => void })?.unlock?.();
    } catch {
      // Navegador sin bloqueo de orientación.
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  private startSlowHint(): void {
    this.clearSlowHint();
    this.slowTimer = setTimeout(() => this.slowServer.set(true), SLOW_HINT_MS);
  }

  private clearSlowHint(): void {
    if (this.slowTimer !== undefined) {
      clearTimeout(this.slowTimer);
      this.slowTimer = undefined;
    }
    this.slowServer.set(false);
  }

  private startCountdown(): void {
    if (this.capturing || this.isCounting() || this.countdownTimer !== undefined) return;

    this.clearHoldTimer();
    this.isCounting.set(true);
    this.countdown.set(3);
    this.chime(880);

    this.countdownTimer = setInterval(() => {
      const next = this.countdown() - 1;
      if (next > 0) {
        this.countdown.set(next);
        this.chime(880);
        return;
      }
      this.cancelCountdown();
      void this.shoot();
    }, COUNTDOWN_STEP_MS);
  }

  private cancelCountdown(interruptedByMotion = false): void {
    if (this.countdownTimer !== undefined) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = undefined;
    }
    this.clearHoldTimer();
    this.isCounting.set(false);
    this.countdown.set(0);
    this.capturing = false;

    if (interruptedByMotion) {
      this.chime(320);
      this.showNotice('capture.levelLost');
    }
  }

  private showNotice(key: MessageKey, deg?: number): void {
    this.clearNotice();
    this.cameraNotice.set({ key, deg });
    this.noticeTimeout = setTimeout(() => {
      this.cameraNotice.set(null);
      this.noticeTimeout = undefined;
    }, NOTICE_TIMEOUT_MS);
  }

  private clearNotice(): void {
    if (this.noticeTimeout !== undefined) {
      clearTimeout(this.noticeTimeout);
      this.noticeTimeout = undefined;
    }
    this.cameraNotice.set(null);
  }

  private failCamera(key: MessageKey): void {
    this.cameraFailed.set(true);
    this.error.set(key);
    this.closeCamera();
  }

  private cameraMessage(err: unknown): MessageKey {
    switch ((err as DOMException)?.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'capture.cameraNoPermission';
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'capture.cameraNotFound';
      case 'NotReadableError':
        return 'capture.cameraBusy';
      default:
        return 'capture.cameraGeneric';
    }
  }

  private clearHoldTimer(): void {
    if (this.holdTimer !== undefined) {
      clearTimeout(this.holdTimer);
      this.holdTimer = undefined;
    }
  }

  private stopStream(): void {
    const el = this.videoRef()?.nativeElement;
    if (el) {
      el.pause();
      el.srcObject = null;
      el.load();
    }
    this.stream()?.getTracks().forEach((track) => track.stop());
    this.stream.set(undefined);
  }

  private async analyze(source: Blob): Promise<void> {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.clearSlowHint();
    this.error.set(null);
    this.handedOver = false;
    this.revokePreview();

    this.step.set('presign');
    this.progress.set(0);
    this.mode.set('working');

    let blob: Blob;
    let focal35: number | null = null;
    try {
      // El EXIF se lee del fichero original: `compressImage` re-encodea y lo borra.
      [blob, focal35] = await Promise.all([
        compressImage(source),
        source instanceof File ? readFocal35mm(source) : Promise.resolve(null),
      ]);
    } catch {
      if (!this.destroyed) {
        this.error.set('capture.readError');
        this.mode.set('idle');
      }
      return;
    }

    if (this.destroyed || this.mode() !== 'working') return;

    this.previewUrl.set(URL.createObjectURL(blob));
    this.startSlowHint();

    this.sub = this.logs.analyze(blob, focal35).subscribe({
      next: (e) => {
        if (this.destroyed) return;
        if (e.step === 'done') {
          this.clearSlowHint();
          this.store.set(e.result, this.previewUrl());
          this.handedOver = true; // el store es ahora dueño del object URL
          this.navigateToResult();
          return;
        }
        this.step.set(e.step);
        if (e.step === 'upload') this.progress.set(e.progress);
      },
      error: (err: HttpErrorResponse) => {
        if (this.destroyed) return;
        this.clearSlowHint();
        this.mode.set('idle');
        this.error.set(this.messageFor(err));
        this.revokePreview();
      },
    });
  }

  /**
   * Abre la pantalla de resultado. Si la navegación falla —el caso típico es un trozo de JS
   * que ya no existe porque la app se actualizó con la página abierta— no dejamos la pantalla
   * colgada en «analizando»: se avisa y el análisis sigue disponible en el historial.
   */
  private navigateToResult(): void {
    const failed = (): void => {
      this.handedOver = false;
      this.store.clear();
      this.previewUrl.set(null);
      this.mode.set('idle');
      this.error.set('capture.reloadRequired');
      this.clearSlowHint();
    };
    this.router.navigate(['/result']).then((ok) => {
      if (!ok) failed();
    }, failed);
  }

  private messageFor(err: unknown): MessageKey {
    if ((err as Error)?.name === 'TimeoutError') return 'capture.timeout';
    switch ((err as HttpErrorResponse).status) {
      case 0:
        return 'capture.noConnection';
      case 422:
        return 'capture.noFood';
      case 502:
        return 'capture.inferDown';
      default:
        return 'capture.genericError';
    }
  }

  /**
   * Inicializa y desbloquea el `AudioContext` de forma síncrona dentro del gesto del usuario
   * para que iOS Safari permita reproducir los pitidos durante el nivelado y la cuenta atrás.
   */
  private unlockAudio(): void {
    try {
      const Ctx = window.AudioContext;
      if (!Ctx) return;
      this.audio ??= new Ctx();
      if (this.audio.state === 'suspended') {
        void this.audio.resume();
      }
    } catch {
      // Sin soporte de Web Audio API.
    }
  }

  /**
   * Pitido corto. Con el móvil plano el usuario no ve la pantalla, así que el sonido es
   * la única confirmación fiable (iOS no soporta navigator.vibrate).
   */
  private chime(frequency: number): void {
    try {
      this.unlockAudio();
      const ctx = this.audio;
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
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
