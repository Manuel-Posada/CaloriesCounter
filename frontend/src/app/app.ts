import { Component, HostListener, inject, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { I18nService } from './core/i18n/i18n.service';
import { PreferencesSync } from './core/preferences-sync.service';
import { PreferencesService } from './core/preferences.service';
import { Avatar } from './core/ui/avatar';
import { Drawer } from './core/ui/drawer';

@Component({
  selector: 'app-root',
  imports: [Avatar, Drawer, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @if (auth.isAuthenticated()) {
      <header class="topbar" [class.topbar--scrolled]="isScrolled()">
        <div class="topbar__inner">
          <a routerLink="/" class="topbar__brand" aria-label="CaloriesCounter">
            <span class="topbar__logo" aria-hidden="true">🥗</span>
            <span class="topbar__title">CaloriesCounter</span>
          </a>

          <button
            type="button"
            class="topbar__profile"
            (click)="openAccountMenu()"
            [attr.aria-label]="i18n.t('app.accountMenu')"
          >
            <app-avatar
              class="topbar__avatar"
              [url]="auth.profile()?.picture_url ?? ''"
              [initials]="auth.initials()"
            />
          </button>
        </div>
      </header>
    }

    <main [class.with-nav]="auth.isAuthenticated()">
      <router-outlet />
    </main>

    @if (auth.isAuthenticated()) {
      <nav class="tabbar" [attr.aria-label]="i18n.t('app.primaryNav')">
        <div class="tabbar__inner">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            <span class="tabbar__icon" aria-hidden="true">📷</span>
            <span class="tabbar__label">{{ i18n.t('app.capture') }}</span>
          </a>
          <a routerLink="/history" routerLinkActive="active">
            <span class="tabbar__icon" aria-hidden="true">🕘</span>
            <span class="tabbar__label">{{ i18n.t('app.history') }}</span>
          </a>
        </div>
      </nav>

      <app-drawer />
    }
  `,
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);
  protected readonly isScrolled = signal(false);

  private readonly drawer = viewChild(Drawer);

  constructor() {
    // Instanciar las preferencias al arrancar aplica el tema guardado (y escucha al sistema).
    inject(PreferencesService);
    // Sincroniza idioma/tema/acento con el perfil del usuario.
    inject(PreferencesSync);
    // Tras recargar, los tokens vienen de localStorage y nadie ha pedido aún el perfil.
    // Aquí AuthService ya está construido: pedirlo desde su constructor sería circular.
    if (this.auth.isAuthenticated()) this.auth.loadProfile();
  }

  protected openAccountMenu(): void {
    this.drawer()?.openMenu();
  }

  @HostListener('window:scroll')
  protected onWindowScroll(): void {
    this.isScrolled.set(window.scrollY > 8);
  }
}
