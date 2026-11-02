import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Reserva `/admin` a `is_staff`. `ensureProfile()` resuelve al instante si el perfil ya está
 * cargado y, si no (recarga directa de la URL), espera la petición antes de decidir.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ensureProfile().pipe(map((profile) => (profile?.is_staff ? true : router.createUrlTree(['/']))));
};
