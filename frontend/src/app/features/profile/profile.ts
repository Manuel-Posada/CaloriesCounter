import { Component, effect, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/auth/auth.service';
import { Avatar } from '../../core/ui/avatar';

@Component({
  selector: 'app-profile',
  imports: [Avatar, ReactiveFormsModule],
  template: `
    <section class="page">
      <h1>Perfil</h1>

      <div class="card identity">
        <app-avatar
          class="avatar"
          [url]="profile()?.picture_url ?? ''"
          [initials]="auth.initials()"
        />
        <strong class="name">{{ auth.displayName() || 'Tu cuenta' }}</strong>
        @if (profile()?.email; as email) {
          <span class="muted">{{ email }}</span>
        }
        <span class="chip">Cuenta de Google</span>
      </div>

      <form class="card form" [formGroup]="form" (ngSubmit)="save()">
        <h2>Datos personales</h2>

        <label>
          <span>Nombre</span>
          <input formControlName="first_name" autocomplete="given-name" maxlength="150" />
        </label>

        <label>
          <span>Apellidos</span>
          <input formControlName="last_name" autocomplete="family-name" maxlength="150" />
        </label>

        <p class="hint">El email y la foto vienen de tu cuenta de Google y no se editan aquí.</p>

        @if (error()) {
          <p class="alert" role="alert">{{ error() }}</p>
        }
        @if (saved()) {
          <p class="ok" role="status">Cambios guardados.</p>
        }

        <button class="btn btn--primary btn--block" type="submit" [disabled]="saving() || form.pristine">
          {{ saving() ? 'Guardando…' : 'Guardar cambios' }}
        </button>
      </form>
    </section>
  `,
  styleUrl: './profile.scss',
})
export class Profile {
  protected readonly auth = inject(AuthService);
  protected readonly profile = this.auth.profile;

  private readonly fb = inject(NonNullableFormBuilder);
  protected readonly form = this.fb.group({
    first_name: ['', Validators.maxLength(150)],
    last_name: ['', Validators.maxLength(150)],
  });

  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal<string | null>(null);

  private filled = false;

  constructor() {
    // El perfil puede llegar después de crear el componente.
    effect(() => {
      const p = this.auth.profile();
      if (!p || this.filled) return;
      this.form.setValue({ first_name: p.first_name, last_name: p.last_name });
      this.form.markAsPristine();
      this.filled = true;
    });
  }

  protected save(): void {
    if (this.saving() || this.form.invalid) return;

    this.saving.set(true);
    this.error.set(null);
    this.saved.set(false);

    const { first_name, last_name } = this.form.getRawValue();
    this.auth.updateProfile({ first_name: first_name.trim(), last_name: last_name.trim() }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        this.form.markAsPristine();
      },
      error: () => {
        this.saving.set(false);
        this.error.set('No pudimos guardar los cambios. Inténtalo de nuevo.');
      },
    });
  }
}
