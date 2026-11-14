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
/** Cached copy of the profile to render name and avatar immediately (and if /me/ fails). */
const PROFILE_KEY = 'cc.profile';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** Why the session ended; explained on the login screen. */
export type LogoutReason = 'manual' | 'idle' | 'expired';

// Google Identity Services is loaded dynamically; minimally typed.
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

  /** Reason for the last logout, to show a notice on the login screen. */
  readonly logoutReason = signal<LogoutReason | null>(null);

  readonly isAuthenticated = computed(() => !!this.access() && !!this.refreshToken());

  /** Account profile (GET /me/). `null` while not yet loaded. */
  readonly profile = signal<UserProfile | null>(readCachedProfile());
  /** `true` when the profile comes from the server rather than only from local cache. */
  private readonly profileLoaded = signal(false);
  private profileRetryTimer?: ReturnType<typeof setTimeout>;
  private profileRetries = 0;
  readonly isAdmin = computed(() => this.profile()?.is_staff === true);

  /** Display name: Google's name, or the email local part if unavailable. */
  readonly displayName = computed(() => {
    const p = this.profile();
    if (!p) return '';
    const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
    return full || p.email.split('@')[0];
  });

  /** Initials for the avatar when there is no photo (or it fails to load). */
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
    // Note: do NOT fetch the profile here. The JWT interceptor injects AuthService, and if
    // the request fires during its own construction, injection is circular and fails silently.
    // Initial loading is triggered by `App` (once the service is constructed).
  }

  accessToken(): string | null {
    return this.access();
  }

  hasRefreshToken(): boolean {
    return !!this.refreshToken();
  }

  /** Sends the Google ID token to Django and stores the returned JWT pair. */
  loginWithGoogle(idToken: string): Observable<void> {
    return this.http
      .post<TokenPair>(`${environment.apiUrl}/auth/google/`, { id_token: idToken })
      .pipe(
        tap((t) => this.store(t.access, t.refresh)),
        map(() => void 0),
      );
  }

  /**
   * Refreshes the access token. Concurrent callers share a single request.
   *
   * A network failure does **not** log out: the refresh token is still valid and will
   * retry on the next request. Only a 401/403 means it expired.
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
   * Startup: if the access token is already expired (or about to), refresh it before the
   * first request has to. Silent: if it fails due to network, nothing breaks.
   * Returns `true` if a refresh was started (which will fetch the profile on token save).
   */
  ensureFreshToken(): boolean {
    if (!this.isAuthenticated()) return false;
    const exp = tokenExpiry(this.access());
    if (exp !== null && exp - Date.now() > 60_000) return false;
    this.refresh().subscribe({
      // If refresh fails (network, backend waking up), fetch the profile anyway: with the
      // previous access token if still valid, or via the interceptor refresh if it returns 401.
      error: () => this.loadProfile(),
    });
    return true;
  }

  logout(reason: LogoutReason = 'manual'): void {
    // Only record the reason if there was an active session: calling logout twice should not overwrite it.
    if (this.isAuthenticated()) this.logoutReason.set(reason);
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    this.access.set(null);
    this.refreshToken.set(null);
    if (this.profileRetryTimer !== undefined) clearTimeout(this.profileRetryTimer);
    this.profileRetryTimer = undefined;
    this.profileRetries = 0;
    this.storeProfile(null);
    // Pipeline preference is device-local, but should not be inherited by the next user.
    this.pipelines.reset();
    // Manual or idle logout: do not auto-sign-in again. Only time-based expiration
    // allows auto-select, which keeps normal re-entry fast.
    if (reason !== 'expired' && typeof google !== 'undefined') google.accounts.id.disableAutoSelect();
    void this.router.navigate(['/login']);
  }

  /**
   * Account profile, loaded once. Concurrent callers share the request.
   * Retries on network or server errors (backend waking up) and falls back to `null`:
   * the menu still works using the cached copy.
   */
  ensureProfile(force = false): Observable<UserProfile | null> {
    const cached = this.profile();
    // The cache renders immediately, but does not skip fetching the profile from the server once.
    if (!force && cached && this.profileLoaded()) return of(cached);
    if (!this.isAuthenticated()) return of(null);

    if (!this.profileRequest$) {
      this.profileRequest$ = this.http.get<UserProfile>(`${environment.apiUrl}/me/`).pipe(
        retry({
          count: 2,
          delay: (error: unknown, attempt: number) => {
            const status = (error as HttpErrorResponse)?.status;
            // 401/403 are handled by the interceptor (refresh or logout); retrying does not help.
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

  /** Triggers profile loading without waiting for the result (for startup and post-login). */
  loadProfile(force = false): void {
    this.ensureProfile(force).subscribe((profile) => {
      if (profile) {
        this.profileRetries = 0;
        return;
      }
      // Sleeping backend or brief outage: spaced retries; the app stays usable meanwhile.
      if (!this.isAuthenticated() || this.profileLoaded() || this.profileRetryTimer !== undefined) return;
      if (this.profileRetries >= 3) return;
      this.profileRetries++;
      this.profileRetryTimer = setTimeout(() => {
        this.profileRetryTimer = undefined;
        this.loadProfile();
      }, 15_000);
    });
  }

  /** Saves first and last name. Email and photo come from Google and are not edited here. */
  updateProfile(payload: { first_name: string; last_name: string }): Observable<UserProfile> {
    return this.http
      .patch<UserProfile>(`${environment.apiUrl}/me/`, payload)
      .pipe(tap((profile) => this.storeProfile(profile)));
  }

  /** Saves UI preferences so they follow the user across devices. */
  savePreferences(prefs: {
    locale?: UserProfile['locale'];
    theme?: UserProfile['theme'];
    accent?: UserProfile['accent'];
  }): Observable<UserProfile> {
    return this.http
      .patch<UserProfile>(`${environment.apiUrl}/me/`, prefs)
      .pipe(tap((profile) => this.storeProfile(profile)));
  }

  /** Indicates whether a real OAuth Client ID is configured (not the placeholder). */
  isGoogleConfigured(): boolean {
    const id = environment.googleClientId?.trim() ?? '';
    return id.endsWith('.apps.googleusercontent.com') && !id.startsWith('REEMPLAZAR');
  }

  /** Renders the official "Sign in with Google" button inside `host`. */
  async renderGoogleButton(host: HTMLElement, onCredential: (idToken: string) => void): Promise<void> {
    if (!this.isGoogleConfigured()) {
      throw new Error('GOOGLE_CLIENT_ID_NOT_CONFIGURED');
    }
    await this.loadGis();
    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      // If the Google account is still active in this browser, sign in without tapping anything
      // (noticeably fast re-entry). Disabled after a manual logout.
      auto_select: true,
      // Callback arrives outside Angular's zone.
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
    // On sign-in (or refresh) there is no longer a logout reason to explain on login.
    this.logoutReason.set(null);
    // After a login (or refresh) the profile may still be missing.
    this.loadProfile();
  }

  /** Stores the profile in memory and `localStorage` (to render immediately on open). */
  private storeProfile(profile: UserProfile | null): void {
    this.profile.set(profile);
    this.profileLoaded.set(profile !== null);
    if (profile) this.profileRetries = 0;
    try {
      if (profile) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      else localStorage.removeItem(PROFILE_KEY);
    } catch {
      // Storage full or blocked: the app still works, just loses the cache.
    }
  }

  private loadGis(): Promise<void> {
    if (typeof google !== 'undefined' && google.accounts?.id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      // `hl` sets the language of the official Google button.
      s.src = `${GIS_SRC}?hl=${this.i18n.locale()}`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar Google Identity Services'));
      document.head.appendChild(s);
    });
  }
}

/** JWT `exp` in milliseconds, or `null` if the token cannot be parsed. */
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

/** Profile saved from the last session, to avoid showing "My account" while /me/ loads. */
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

