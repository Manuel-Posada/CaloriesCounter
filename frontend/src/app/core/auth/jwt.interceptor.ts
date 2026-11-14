import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

const PUBLIC_PATHS = ['/auth/google/', '/auth/refresh/'];

/**
 * Attaches `Authorization: Bearer` ONLY to requests to our API (never to R2:
 * the presigned URL already carries its signature and an extra header would invalidate it).
 * On a 401, attempts to refresh the token once and retries; if that fails, logs out.
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
        // The service already logs out if the refresh token expired. A network error MUST NOT
        // sign the user out: propagate the error and retry on the next request.
      );
    }),
  );
};

