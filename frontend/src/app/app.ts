import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { I18nService } from './core/i18n/i18n.service';
import { PreferencesService } from './core/preferences.service';
import { Avatar } from './core/ui/avatar';
import { Drawer } from './core/ui/drawer';

@Component({
  selector: 'app-root',
  imports: [Avatar, Drawer, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <main [class.with-nav]="auth.isAuthenticated()">
      <router-outlet />
    </main>

    @if (auth.isAuthenticated()) {
      <nav class="tabbar" [attr.aria-label]="i18n.t('app.primaryNav')">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
          <span aria-hidden="true">📷</span>{{ i18n.t('app.capture') }}
        </a>
        <a routerLink="/history" routerLinkActive="active"
          ><span aria-hidden="true">🕘</span>{{ i18n.t('app.history') }}</a
        >
        <button type="button" class="account" (click)="drawer.openMenu()" [attr.aria-label]="i18n.t('app.accountMenu')">
          <app-avatar
            class="avatar"
            [url]="auth.profile()?.picture_url ?? ''"
            [initials]="auth.initials()"
          />
          <span class="label">{{ i18n.t('app.account') }}</span>
        </button>
      </nav>

      <app-drawer #drawer />
    }
  `,
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly i18n = inject(I18nService);

  constructor() {
    // Instanciar las preferencias al arrancar aplica el tema guardado (y escucha al sistema).
    inject(PreferencesService);
    // Tras recargar, los tokens vienen de localStorage y nadie ha pedido aún el perfil.
    // Aquí AuthService ya está construido: pedirlo desde su constructor sería circular.
    if (this.auth.isAuthenticated()) this.auth.loadProfile();
  }
}
