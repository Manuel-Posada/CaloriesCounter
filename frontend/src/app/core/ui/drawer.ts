import { Component, ElementRef, OnDestroy, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../auth/auth.service';
import { I18nService } from '../i18n/i18n.service';
import { Avatar } from './avatar';

/** Exit animation duration of the side drawer (synced with `drawer.scss`). */
const DRAWER_CLOSE_MS = 240;
/** Pixel threshold (or velocity in px/ms) to close the drawer when swiping right. */
const DRAWER_SWIPE_PX = 95;
const DRAWER_SWIPE_VELOCITY = 0.45;

/**
 * Account side drawer. Opens from the bottom-bar avatar and replaces the
 * old "Logout" button: profile, settings, and admin live here.
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
        [style.opacity]="isDragging() ? Math.max(0.15, 1 - dragOffset() / 320) : null"
        (click)="close()"
      ></div>

      <aside
        class="drawer"
        [class.drawer--open]="open() && !isClosing()"
        [class.drawer--closing]="isClosing()"
        [class.drawer--dragging]="isDragging()"
        [class.drawer--rebounding]="isRebounding()"
        [style.--drawer-drag-x]="dragOffset() + 'px'"
        [style.transform]="
          isDragging() ? 'translateX(' + dragOffset() + 'px)' : isRebounding() ? 'translateX(0px)' : null
        "
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-name"
        (touchstart)="onTouchStart($event)"
        (touchmove)="onTouchMove($event)"
        (touchend)="onTouchEnd()"
        (touchcancel)="onTouchEnd()"
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
  protected readonly Math = Math;
  protected readonly open = signal(false);
  protected readonly isClosing = signal(false);
  protected readonly dragOffset = signal(0);
  protected readonly isDragging = signal(false);
  protected readonly isRebounding = signal(false);

  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');
  private closeTimer?: ReturnType<typeof setTimeout>;
  private touchStartX = 0;
  private touchStartY = 0;
  private touchStartTime = 0;
  private gestureAxis: 'x' | 'y' | null = null;

  constructor() {
    // Locks scroll and pushes the background in 3D while the drawer is active (and not closing).
    effect((onCleanup) => {
      const active = this.open() && !this.isClosing();
      document.body.classList.toggle('menu-open', active);
      onCleanup(() => document.body.classList.remove('menu-open'));
    });
  }

  openMenu(): void {
    this.clearCloseTimer();
    this.isClosing.set(false);
    this.isDragging.set(false);
    this.isRebounding.set(false);
    this.dragOffset.set(0);
    this.open.set(true);
    // Profile may be missing after a slow login or network error: retry on open.
    this.auth.loadProfile();
    setTimeout(() => this.closeBtn()?.nativeElement.focus());
  }

  close(): void {
    if (!this.open() || this.isClosing()) return;
    this.isDragging.set(false);
    this.isRebounding.set(false);
    this.isClosing.set(true);
    this.closeTimer = setTimeout(() => {
      this.closeTimer = undefined;
      this.open.set(false);
      this.isClosing.set(false);
      this.dragOffset.set(0);
    }, DRAWER_CLOSE_MS);
  }

  protected onTouchStart(ev: TouchEvent): void {
    if (!this.open() || this.isClosing() || ev.touches.length !== 1) return;
    const t = ev.touches[0]!;
    this.touchStartX = t.clientX;
    this.touchStartY = t.clientY;
    this.touchStartTime = performance.now();
    this.gestureAxis = null;
    this.isDragging.set(false);
    this.dragOffset.set(0);
  }

  protected onTouchMove(ev: TouchEvent): void {
    if (!this.open() || this.isClosing() || ev.touches.length !== 1) return;
    const t = ev.touches[0]!;
    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;

    if (this.gestureAxis === null) {
      if (Math.hypot(dx, dy) < 8) return;
      this.gestureAxis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    }
    if (this.gestureAxis !== 'x') return;

    if (ev.cancelable) ev.preventDefault();
    this.isRebounding.set(false);
    this.isDragging.set(true);
    // Only drag right (dx >= 0) to keep the right edge flush against the screen.
    this.dragOffset.set(Math.max(0, dx));
  }

  protected onTouchEnd(): void {
    if (!this.isDragging()) {
      this.gestureAxis = null;
      return;
    }

    const offset = this.dragOffset();
    const dt = Math.max(1, performance.now() - this.touchStartTime);
    const velocity = offset / dt;
    this.gestureAxis = null;
    this.isDragging.set(false);

    if (offset >= DRAWER_SWIPE_PX || (offset > 30 && velocity >= DRAWER_SWIPE_VELOCITY)) {
      this.close();
      return;
    }

    this.isRebounding.set(true);
    this.dragOffset.set(0);
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
