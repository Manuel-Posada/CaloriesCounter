import { AfterViewInit, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  template: `
    <section class="login">
      <div class="logo" aria-hidden="true">🥗</div>
      <h1>CaloriesCounter</h1>
      <p class="muted">Fotografía tu plato y descubre calorías y macros al instante.</p>

      <div #gbtn class="gbtn"></div>

      @if (loading()) {
        <div class="status"><span class="spinner"></span> Iniciando sesión…</div>
      }
      @if (error()) {
        <p class="alert" role="alert">{{ error() }}</p>
      }
    </section>
  `,
  styleUrl: './login.scss',
})
export class Login implements AfterViewInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  @ViewChild('gbtn', { static: true }) gbtn!: ElementRef<HTMLElement>;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  ngAfterViewInit(): void {
    this.auth
      .renderGoogleButton(this.gbtn.nativeElement, (idToken) => this.onCredential(idToken))
      .catch((err: Error) => {
        this.error.set(
          err?.message === 'GOOGLE_CLIENT_ID_NOT_CONFIGURED'
            ? 'Login con Google sin configurar: falta el OAuth Client ID en environment.ts (Google Cloud Console).'
            : 'No se pudo cargar el inicio de sesión de Google. Revisa tu conexión.',
        );
      });
  }

  private onCredential(idToken: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.auth.loginWithGoogle(idToken).subscribe({
      next: () => this.router.navigate(['/']),
      error: () => {
        this.loading.set(false);
        this.error.set('No pudimos validar tu cuenta de Google. Inténtalo de nuevo.');
      },
    });
  }
}

