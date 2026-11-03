import { Component, ElementRef, OnDestroy, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { I18nService } from '../i18n/i18n.service';
import { Avatar } from './avatar';

/** Duración de la animación de salida del menú lateral (sincronizada con `drawer.scss`). */
const DRAWER_CLOSE_MS = 240;

/**
 * Menú lateral de cuenta. Se abre desde el avatar de la barra inferior y sustituye al
 * antiguo botón "Salir": aquí viven el perfil, la configuración y la administración.
 */
@Component({
  selector: 'app-drawer',
  imports: [Avatar, RouterLink, RouterLinkActive],
  template: `
    @if (open()) {
      <div
        class="scrim"
        [class.scrim--open]="open() && !isClosing()"
        [class.scrim--closing]="isClosing()"
        (click)="close()"
      ></div>

      <aside
        class="drawer"
        [class.drawer--open]="open() && !isClosing()"
        [class.drawer--closing]="isClosing()"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-name"
      >
        <header class="head">
          <a class="account" routerLink="/profile" (click)="close()">
            <app-avatar
              class="avatar"
              [url]="auth.profile()?.picture_url ?? ''"
              [initials]="auth.initials()"
            />
            <span class="who">
              <strong id="drawer-name">{{ auth.displayName() || i18n.t('profile.myAccount') }}</strong>
              @if (auth.profile()?.email; as email) {
                <span class="email">{{ email }}</span>
              }
            </span>
          </a>
          <button #closeBtn type="button" class="close" [attr.aria-label]="i18n.t('drawer.close')" (click)="close()">
            ✕
          </button>
        </header>

        <nav class="items" [attr.aria-label]="i18n.t('app.account')">
          <a routerLink="/profile" routerLinkActive="active" (click)="close()">
            <span class="ico" aria-hidden="true">👤</span>{{ i18n.t('drawer.profile') }}
          </a>
          <a routerLink="/settings" routerLinkActive="active" (click)="close()">
            <span class="ico" aria-hidden="true">⚙️</span>{{ i18n.t('drawer.settings') }}
          </a>
          @if (auth.isAdmin()) {
            <a routerLink="/admin" routerLinkActive="active" (click)="close()">
              <span class="ico" aria-hidden="true">🛡️</span>{{ i18n.t('drawer.admin') }}
            </a>
          }
        </nav>

        <button type="button" class="logout" (click)="logout()">
          <span class="ico" aria-hidden="true">🚪</span>{{ i18n.t('drawer.logout') }}
        </button>

        <p class="brand">CaloriesCounter</p>
      </aside>
    }
  `,
  styleUrl: './drawer.scss',
  host: { '(document:keydown.escape)': 'close()' },
})
export class Drawer implements OnDestroy {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);
  protected readonly open = signal(false);
  protected readonly isClosing = signal(false);

  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private closeTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Bloquea el scroll y empuja el fondo en 3D mientras el menú está activo (y no cerrándose).
    effect((onCleanup) => {
      const active = this.open() && !this.isClosing();
      document.body.classList.toggle('menu-open', active);
      onCleanup(() => document.body.classList.remove('menu-open'));
    });
  }

  openMenu(): void {
    this.clearCloseTimer();
    this.isClosing.set(false);
    this.open.set(true);
    // El perfil puede faltar tras un login lento o un fallo de red: se reintenta al abrir.
    this.auth.loadProfile();
    setTimeout(() => this.closeBtn()?.nativeElement.focus());
  }

  close(): void {
    if (!this.open() || this.isClosing()) return;
    this.isClosing.set(true);
    this.closeTimer = setTimeout(() => {
      this.closeTimer = undefined;
      this.open.set(false);
      this.isClosing.set(false);
    }, DRAWER_CLOSE_MS);
  }

  ngOnDestroy(): void {
    this.clearCloseTimer();
  }

  protected logout(): void {
    this.close();
    this.auth.logout();
  }

  private clearCloseTimer(): void {
    if (this.closeTimer !== undefined) {
      clearTimeout(this.closeTimer);
      this.closeTimer = undefined;
    }
  }
}
