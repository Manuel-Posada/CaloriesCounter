import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

const PUBLIC_PATHS = ['/auth/google/', '/auth/refresh/'];

/**
 * Adjunta `Authorization: Bearer` SOLO a peticiones hacia nuestra API (nunca a R2:
 * la URL prefirmada ya lleva su firma y un header extra la invalidaría).
 * Ante un 401 intenta renovar el token una vez y reintenta; si falla, cierra sesión.
 */
export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  const isApi = req.url.startsWith(environment.apiUrl);
  const isPublic = PUBLIC_PATHS.some((p) => req.url.includes(p));
  if (!isApi || isPublic) return next(req);

  const withToken = (r: HttpRequest<unknown>, token: string) =>
    r.clone({ setHeaders: { Authorization: `Bearer ${token}` } });

  const token = auth.accessToken();
  return next(token ? withToken(req, token) : req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);
      if (!auth.hasRefreshToken()) {
        auth.logout();
        return throwError(() => err);
      }
      return auth.refresh().pipe(
        switchMap((newToken) => next(withToken(req, newToken))),
        catchError((refreshErr) => {
          auth.logout();
          return throwError(() => refreshErr);
        }),
      );
    }),
  );
};

