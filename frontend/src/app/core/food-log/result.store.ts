import { Injectable, signal } from '@angular/core';
import { FoodLogCreated } from '../models';

/** Pasa el resultado de Captura a Resultados y conserva la foto local para mostrarla al instante. */
@Injectable({ providedIn: 'root' })
export class ResultStore {
  readonly result = signal<FoodLogCreated | null>(null);
  readonly preview = signal<string | null>(null);

  set(result: FoodLogCreated, previewUrl: string | null): void {
    const old = this.preview();
    if (old && old !== previewUrl) URL.revokeObjectURL(old);
    this.result.set(result);
    this.preview.set(previewUrl);
  }

  clear(): void {
    const old = this.preview();
    if (old) URL.revokeObjectURL(old);
    this.result.set(null);
    this.preview.set(null);
  }
}

