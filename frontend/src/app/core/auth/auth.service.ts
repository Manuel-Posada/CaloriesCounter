import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, retry, shareReplay, tap, throwError, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PipelineService } from '../food-log/pipeline.service';
import { I18nService } from '../i18n/i18n.service';
import { TokenPair, UserProfile } from '../models';

const ACCESS_KEY = 'cc.access';
const REFRESH_KEY = 'cc.refresh';
/** Copia del perfil para pintar el nombre y el avatar al instante (y si /me/ falla). */
const PROFILE_KEY = 'cc.profile';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** Por qué se cerró la sesión; la pantalla de login lo explica. */
export type LogoutReason = 'manual' | 'idle' | 'expired';

// Google Identity Services se carga dinámicamente; se tipa mínimamente.
declare const google: any;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly pipelines = inject(PipelineService);
  private readonly i18n = inject(I18nService);

  private readonly access = signal<string | null>(localStorage.getItem(ACCESS_KEY));
  private readonly refreshToken = signal<string | null>(localStorage.getItem(REFRESH_KEY));
  private refreshInFlight$?: Observable<string>;
  private profileRequest$?: Observable<UserProfile | null>;

  /** Motivo del último cierre de sesión, para avisar en la pantalla de login. */
  readonly logoutReason = signal<LogoutReason | null>(null);

  readonly isAuthenticated = computed(() => !!this.access() && !!this.refreshToken());

  /** Perfil de la cuenta (GET /me/). `null` mientras no se haya cargado. */
  readonly profile = signal<UserProfile | null>(readCachedProfile());
  /** `true` cuando el perfil viene del servidor y no solo de la caché local. */
  private readonly profileLoaded = signal(false);
  private profileRetryTimer?: ReturnType<typeof setTimeout>;
  private profileRetries = 0;
  readonly isAdmin = computed(() => this.profile()?.is_staff === true);

  /** Nombre a mostrar: el de Google y, si no hay, la parte local del email. */
  readonly displayName = computed(() => {
    const p = this.profile();
    if (!p) return '';
    const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
    return full || p.email.split('@')[0];
  });

  /** Iniciales para el avatar cuando no hay foto (o falla al cargar). */
  readonly initials = computed(() => {
    const name = this.displayName();
    if (!name) return '?';
    return name
      .split(/[\s._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('');
  });

  constructor() {
    // Ojo: aquí NO se puede pedir el perfil. El interceptor JWT inyecta AuthService y, si la
    // petición sale durante su propia construcción, la inyección es circular y falla en silencio.
    // La carga inicial la dispara `App` (ya con el servicio construido).
  }

  accessToken(): string | null {
    return this.access();
  }

  hasRefreshToken(): boolean {
    return !!this.refreshToken();
  }

  /** Envía el ID token de Google a Django y guarda el par JWT recibido. */
  loginWithGoogle(idToken: string): Observable<void> {
    return this.http
      .post<TokenPair>(`${environment.apiUrl}/auth/google/`, { id_token: idToken })
      .pipe(
        tap((t) => this.store(t.access, t.refresh)),
        map(() => void 0),
      );
  }

  /**
   * Renueva el access token. Las llamadas concurrentes comparten una sola petición.
   *
   * Un fallo de red **no** cierra la sesión: el refresh token sigue siendo válido y se
   * reintentará en la siguiente petición. Solo un 401/403 significa que caducó.
   */
  refresh(): Observable<string> {
    if (!this.refreshInFlight$) {
      this.refreshInFlight$ = this.http
        .post<{ access: string; refresh?: string }>(`${environment.apiUrl}/auth/refresh/`, {
          refresh: this.refreshToken(),
        })
        .pipe(
          tap((t) => this.store(t.access, t.refresh ?? this.refreshToken()!)),
          map((t) => t.access),
          catchError((err: unknown) => {
            const status = (err as HttpErrorResponse)?.status;
            if (status === 401 || status === 403) this.logout('expired');
            return throwError(() => err);
          }),
          finalize(() => (this.refreshInFlight$ = undefined)),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.refreshInFlight$;
  }

  /**
   * Arranque: si el access token ya caducó (o está a punto), lo renueva antes de que la
   * primera petición tenga que hacerlo. Silencioso: si falla por red, no pasa nada.
   * Devuelve `true` si lanzó el refresco (que ya pedirá el perfil al guardar el token).
   */
  ensureFreshToken(): boolean {
    if (!this.isAuthenticated()) return false;
    const exp = tokenExpiry(this.access());
    if (exp !== null && exp - Date.now() > 60_000) return false;
    this.refresh().subscribe({
      // Si el refresco no llega (red, backend despertando), el perfil se pide igual: con el
      // access anterior si aún vale, o con el refresh del interceptor si devuelve 401.
      error: () => this.loadProfile(),
    });
    return true;
  }

  logout(reason: LogoutReason = 'manual'): void {
    // Solo se anota el motivo si había sesión: cerrar dos veces no debe reescribirlo.
    if (this.isAuthenticated()) this.logoutReason.set(reason);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.access.set(null);
    this.refreshToken.set(null);
    if (this.profileRetryTimer !== undefined) clearTimeout(this.profileRetryTimer);
    this.profileRetryTimer = undefined;
    this.profileRetries = 0;
    this.storeProfile(null);
    // La preferencia de pipeline es del dispositivo, pero no debe heredarla el siguiente usuario.
    this.pipelines.reset();
    // Cierre manual o por inactividad: no se vuelve a entrar solo. Solo una caducidad por
    // tiempo permite el auto-acceso, que es lo que hace rápida la reentrada normal.
    if (reason !== 'expired' && typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
    void this.router.navigate(['/login']);
  }

  /**
   * Perfil de la cuenta, cargado una sola vez. Las llamadas concurrentes comparten petición.
   * Reintenta si el fallo es de red o del servidor (backend despertando) y devuelve `null`
   * como último recurso: el menú funciona igual con la copia en caché.
   */
  ensureProfile(force = false): Observable<UserProfile | null> {
    const cached = this.profile();
    // La caché pinta al instante, pero no evita pedir el perfil al servidor una vez.
    if (!force && cached && this.profileLoaded()) return of(cached);
    if (!this.isAuthenticated()) return of(null);

    if (!this.profileRequest$) {
      this.profileRequest$ = this.http.get<UserProfile>(`${environment.apiUrl}/me/`).pipe(
        retry({
          count: 2,
          delay: (error: unknown, attempt: number) => {
            const status = (error as HttpErrorResponse)?.status;
            // 401/403 los gestiona el interceptor (refresh o cierre); reintentar no aporta.
            return status === 0 || status >= 500 ? timer(attempt * 1500) : throwError(() => error);
          },
        }),
        tap((p) => this.storeProfile(p)),
        catchError(() => of(null)),
        finalize(() => (this.profileRequest$ = undefined)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.profileRequest$;
  }

  /** Dispara la carga sin esperar al resultado (para el arranque y tras el login). */
  loadProfile(force = false): void {
    this.ensureProfile(force).subscribe((profile) => {
      if (profile) {
        this.profileRetries = 0;
        return;
      }
      // Backend dormido o microcorte: reintentos espaciados; la app sigue usable mientras.
      if (!this.isAuthenticated() || this.profileLoaded() || this.profileRetryTimer !== undefined) return;
      if (this.profileRetries >= 3) return;
      this.profileRetries++;
      this.profileRetryTimer = setTimeout(() => {
        this.profileRetryTimer = undefined;
        this.loadProfile();
      }, 15_000);
    });
  }

  /** Guarda nombre y apellidos. El email y la foto vienen de Google y no se editan aquí. */
  updateProfile(payload: { first_name: string; last_name: string }): Observable<UserProfile> {
    return this.http
      .patch<UserProfile>(`${environment.apiUrl}/me/`, payload)
      .pipe(tap((profile) => this.storeProfile(profile)));
  }

  /** Guarda las preferencias de interfaz para que sigan al usuario entre dispositivos. */
  savePreferences(prefs: {
    locale?: UserProfile['locale'];
    theme?: UserProfile['theme'];
    accent?: UserProfile['accent'];
  }): Observable<UserProfile> {
    return this.http
      .patch<UserProfile>(`${environment.apiUrl}/me/`, prefs)
      .pipe(tap((profile) => this.storeProfile(profile)));
  }

  /** Indica si hay un OAuth Client ID real configurado (no el placeholder). */
  isGoogleConfigured(): boolean {
    const id = environment.googleClientId?.trim() ?? '';
    return id.endsWith('.apps.googleusercontent.com') && !id.startsWith('REEMPLAZAR');
  }

  /** Renderiza el botón oficial "Sign in with Google" dentro de `host`. */
  async renderGoogleButton(host: HTMLElement, onCredential: (idToken: string) => void): Promise<void> {
    if (!this.isGoogleConfigured()) {
      throw new Error('GOOGLE_CLIENT_ID_NOT_CONFIGURED');
    }
    await this.loadGis();
    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      // Si la cuenta de Google sigue activa en este navegador, entra sin tocar nada (la
      // velocidad de reentrada que se nota). Tras un cierre manual se desactiva.
      auto_select: true,
      // El callback llega fuera de la zona de Angular.
      callback: (r: { credential: string }) => this.zone.run(() => onCredential(r.credential)),
    });
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    host.innerHTML = '';
    google.accounts.id.renderButton(host, {
      type: 'standard',
      theme: isDark ? 'filled_black' : 'outline',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      width: Math.min(320, host.clientWidth || 320),
    });
  }

  private store(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
    this.access.set(access);
    this.refreshToken.set(refresh);
    // Al entrar (o renovar) ya no hay motivo que explicar en el login.
    this.logoutReason.set(null);
    // Tras un login (o un refresh) el perfil puede faltar todavía.
    this.loadProfile();
  }

  /** Guarda el perfil en memoria y en `localStorage` (para pintarlo al instante al abrir). */
  private storeProfile(profile: UserProfile | null): void {
    this.profile.set(profile);
    this.profileLoaded.set(profile !== null);
    if (profile) this.profileRetries = 0;
    try {
      if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      else localStorage.removeItem(PROFILE_KEY);
    } catch {
      // Almacenamiento lleno o bloqueado: la app funciona igual, solo pierde la caché.
    }
  }

  private loadGis(): Promise<void> {
    if (typeof google !== 'undefined' && google.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // `hl` fija el idioma del botón oficial de Google.
      s.src = `${GIS_SRC}?hl=${this.i18n.locale()}`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
      document.head.appendChild(s);
    });
  }
}

/** `exp` del JWT en milisegundos, o `null` si el token no se puede leer. */
function tokenExpiry(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Perfil guardado de la última sesión, para no mostrar «Mi cuenta» mientras llega /me/. */
function readCachedProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as UserProfile;
    return typeof data?.email === 'string' && data.email ? data : null;
  } catch {
    return null;
  }
}

