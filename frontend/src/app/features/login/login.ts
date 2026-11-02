import { AfterViewInit, Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';

/** Frases de bienvenida: la clave se elige al azar una vez y el texto sigue al idioma. */
const LOGIN_PHRASE_KEYS: readonly MessageKey[] = [
  'login.phrase1',
  'login.phrase2',
  'login.phrase3',
  'login.phrase4',
];

@Component({
  selector: 'app-login',
  template: `
    <section class="login">
      <div class="logo" aria-hidden="true">🥗</div>
      <h1>CaloriesCounter</h1>
      <p class="muted">{{ dynamicTagline() }}</p>

      <div #gbtn class="gbtn"></div>

      @if (loading()) {
        <div class="status"><span class="spinner"></span> {{ i18n.t('login.loading') }}</div>
      }
      @if (error(); as key) {
        <p class="alert" role="alert">{{ i18n.t(key) }}</p>
      }
    </section>
  `,
  styleUrl: './login.scss',
})
export class Login implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  @ViewChild('gbtn', { static: true }) gbtn!: ElementRef<HTMLElement>;

  private readonly phraseIndex = Math.floor(Math.random() * LOGIN_PHRASE_KEYS.length);
  protected readonly dynamicTagline = computed(() => this.i18n.t(LOGIN_PHRASE_KEYS[this.phraseIndex]));
  protected readonly loading = signal(false);
  protected readonly error = signal<MessageKey | null>(null);

  ngAfterViewInit(): void {
    this.auth
      .renderGoogleButton(this.gbtn.nativeElement, (idToken) => this.onCredential(idToken))
      .catch((err: Error) => {
        this.error.set(err?.message === 'GOOGLE_CLIENT_ID_NOT_CONFIGURED' ? 'login.noClient' : 'login.gisError');
      });
  }

  private onCredential(idToken: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.auth.loginWithGoogle(idToken).subscribe({
      next: () => this.router.navigate(['/']),
      error: () => {
        this.loading.set(false);
        this.error.set('login.invalid');
      },
    });
  }
}
