import { Component, computed, input, signal } from '@angular/core';

/**
 * Avatar redondo. Usa la foto de Google y, si no hay o falla al cargar, las iniciales.
 * El tamaño y el radio los decide quien lo coloca (`class="avatar"` en el padre).
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
      font-weight: 700;
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
  /** URL del avatar; cadena vacía si no hay. */
  readonly url = input<string>('');
  /** Texto de respaldo (normalmente las iniciales del usuario). */
  readonly initials = input<string>('?');

  protected readonly failed = signal(false);
  protected readonly src = computed(() => {
    const url = this.url();
    return url && !this.failed() ? url : null;
  });
}
