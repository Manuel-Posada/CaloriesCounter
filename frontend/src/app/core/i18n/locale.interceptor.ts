import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { I18nService } from './i18n.service';

/**
 * Sends the UI language to the API so server-generated texts
 * (Gemini advice, warnings) are returned in the user's language.
 */
export const localeInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);
  const i18n = inject(I18nService);
  return next(req.clone({ setHeaders: { 'Accept-Language': i18n.locale() } }));
};
