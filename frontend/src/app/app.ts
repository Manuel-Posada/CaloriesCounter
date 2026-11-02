import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
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
      <nav class="tabbar" aria-label="Principal">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
          <span aria-hidden="true">📷</span>Capturar
        </a>
        <a routerLink="/history" routerLinkActive="active"><span aria-hidden="true">🕘</span>Historial</a>
        <button type="button" class="account" (click)="drawer.openMenu()" aria-label="Abrir el menú de cuenta">
          <app-avatar
            class="avatar"
            [url]="auth.profile()?.picture_url ?? ''"
            [initials]="auth.initials()"
          />
          <span class="label">Cuenta</span>
        </button>
      </nav>

      <app-drawer #drawer />
    }
  `,
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);

  constructor() {
    // Instanciar las preferencias al arrancar aplica el tema guardado (y escucha al sistema).
    inject(PreferencesService);
    // Tras recargar, los tokens vienen de localStorage y nadie ha pedido aún el perfil.
    // Aquí AuthService ya está construido: pedirlo desde su constructor sería circular.
    if (this.auth.isAuthenticated()) this.auth.loadProfile();
  }
}
