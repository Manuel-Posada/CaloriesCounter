import { Component, HostListener, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { warmUpApi } from './core/api-warmup';
import { AuthService } from './core/auth/auth.service';
import { IdleService } from './core/auth/idle.service';
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
            <img class="topbar__logo" src="logo.png" alt="" aria-hidden="true" width="26" height="26" />
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

    @if (idle.warning()) {
      <div class="idle-warning" role="alertdialog" aria-live="assertive">
        <p>{{ i18n.t('session.idleWarning') }}</p>
        <button type="button" class="btn btn--primary" (click)="idle.keepAlive()">
          {{ i18n.t('session.keepAlive') }}
        </button>
      </div>
    }
  `,
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly idle = inject(IdleService);
  protected readonly i18n = inject(I18nService);
  protected readonly isScrolled = signal(false);

  private readonly drawer = viewChild(Drawer);

  constructor() {
    // Instantiating preferences on startup applies the saved theme (and listens to system changes).
    inject(PreferencesService);
    // Syncs language/theme/accent with the user's profile.
    inject(PreferencesSync);
    // Wakes up the backend (Render sleeps after 15 min) while the user is still navigating.
    warmUpApi();
    // After reload, tokens come from localStorage and no one has requested the profile yet.
    // AuthService is already constructed here: requesting it from its constructor would be circular.
    if (this.auth.isAuthenticated()) {
      // If the access token is already expired, refresh it before the first request fails
      // (refreshing already fetches the profile when saving the new token).
      if (!this.auth.ensureFreshToken()) this.auth.loadProfile();
    }
    // Logs out after 30 min of inactivity (with a warning one minute prior).
    effect(() => {
      if (this.auth.isAuthenticated()) this.idle.start();
      else this.idle.stop();
    });
  }

  protected openAccountMenu(): void {
    this.drawer()?.openMenu();
  }

  /** Returning to the tab or recovering network: retry if the profile hasn't arrived. */
  @HostListener('document:visibilitychange')
  @HostListener('window:online')
  protected onMaybeBack(): void {
    if (document.hidden) return;
    if (this.auth.isAuthenticated() && !this.auth.profile()) this.auth.loadProfile();
  }

  @HostListener('window:scroll')
  protected onWindowScroll(): void {
    this.isScrolled.set(window.scrollY > 8);
  }
}
