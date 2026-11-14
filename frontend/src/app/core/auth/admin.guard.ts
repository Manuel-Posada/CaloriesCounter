import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Restricts `/admin` to `is_staff`. `ensureProfile()` resolves immediately if the profile is
 * already loaded and, if not (direct URL reload), awaits the request before deciding.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.ensureProfile().pipe(map((profile) => (profile?.is_staff ? true : router.createUrlTree(['/']))));
};
