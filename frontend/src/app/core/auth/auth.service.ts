import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PipelineService } from '../food-log/pipeline.service';
import { TokenPair, UserProfile } from '../models';

const ACCESS_KEY = 'cc.access';
const REFRESH_KEY = 'cc.refresh';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Google Identity Services se carga dinámicamente; se tipa mínimamente.
declare const google: any;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly zone = inject(NgZone);
  private readonly pipelines = inject(PipelineService);

  private readonly access = signal<string | null>(localStorage.getItem(ACCESS_KEY));
  private readonly refreshToken = signal<string | null>(localStorage.getItem(REFRESH_KEY));
  private refreshInFlight$?: Observable<string>;
  private profileRequest$?: Observable<UserProfile | null>;

  readonly isAuthenticated = computed(() => !!this.access() && !!this.refreshToken());

  /** Perfil de la cuenta (GET /me/). `null` mientras no se haya cargado. */
  readonly profile = signal<UserProfile | null>(null);
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

  /** Renueva el access token. Las llamadas concurrentes comparten una sola petición. */
  refresh(): Observable<string> {
    if (!this.refreshInFlight$) {
      this.refreshInFlight$ = this.http
        .post<{ access: string; refresh?: string }>(`${environment.apiUrl}/auth/refresh/`, {
          refresh: this.refreshToken(),
        })
        .pipe(
          tap((t) => this.store(t.access, t.refresh ?? this.refreshToken()!)),
          map((t) => t.access),
          finalize(() => (this.refreshInFlight$ = undefined)),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.refreshInFlight$;
  }

  logout(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.access.set(null);
    this.refreshToken.set(null);
    this.profile.set(null);
    // La preferencia de pipeline es del dispositivo, pero no debe heredarla el siguiente usuario.
    this.pipelines.reset();
    if (typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
    this.router.navigate(['/login']);
  }

  /**
   * Perfil de la cuenta, cargado una sola vez. Las llamadas concurrentes comparten petición.
   * Devuelve `null` si falla: el menú funciona igual, solo pierde el avatar y el acceso admin.
   */
  ensureProfile(force = false): Observable<UserProfile | null> {
    const cached = this.profile();
    if (cached && !force) return of(cached);
    if (!this.isAuthenticated()) return of(null);

    if (!this.profileRequest$) {
      this.profileRequest$ = this.http.get<UserProfile>(`${environment.apiUrl}/me/`).pipe(
        tap((p) => this.profile.set(p)),
        catchError(() => of(null)),
        finalize(() => (this.profileRequest$ = undefined)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.profileRequest$;
  }

  /** Dispara la carga sin esperar al resultado (para el arranque y tras el login). */
  loadProfile(force = false): void {
    this.ensureProfile(force).subscribe();
  }

  /** Guarda nombre y apellidos. El email y la foto vienen de Google y no se editan aquí. */
  updateProfile(payload: { first_name: string; last_name: string }): Observable<UserProfile> {
    return this.http
      .patch<UserProfile>(`${environment.apiUrl}/me/`, payload)
      .pipe(tap((profile) => this.profile.set(profile)));
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
      // El callback llega fuera de la zona de Angular.
      callback: (r: { credential: string }) => this.zone.run(() => onCredential(r.credential)),
    });
    google.accounts.id.renderButton(host, {
      type: 'standard',
      theme: 'outline',
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
    // Tras un login (o un refresh) el perfil puede faltar todavía.
    this.loadProfile();
  }

  private loadGis(): Promise<void> {
    if (typeof google !== 'undefined' && google.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
      document.head.appendChild(s);
    });
  }
}

