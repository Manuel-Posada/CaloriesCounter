import { Component, computed, input, signal } from '@angular/core';

/**
 * Round avatar. Uses the Google photo and, if missing or failed to load, falls back to initials.
 * Size and border-radius are decided by the parent (`class="avatar"` on the host).
 */
@Component({
  selector: 'app-avatar',
  template: `
    @if (src(); as s) {
      <img [src]="s" alt="" referrerpolicy="no-referrer" (error)="failed.set(true)" />
    } @else {
      <span aria-hidden="true">{{ initials() }}</span>
    }
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      overflow: hidden;
      border-radius: 50%;
      background: var(--c-primary-soft);
      color: var(--c-primary-dark);
      font-weight: 600;
      line-height: 1;
      user-select: none;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class Avatar {
  /** Avatar URL; empty string if none. */
  readonly url = input<string>('');
  /** Fallback text (typically the user's initials). */
  readonly initials = input<string>('?');

  protected readonly failed = signal(false);
  protected readonly src = computed(() => {
    const url = this.url();
    return url && !this.failed() ? url : null;
  });
}
