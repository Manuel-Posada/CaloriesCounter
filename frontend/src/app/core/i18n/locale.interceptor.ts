import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { I18nService } from './i18n.service';

/**
 * Manda el idioma de la interfaz a la API para que los textos que genera el servidor
 * (consejo de Gemini, avisos) salgan en el idioma del usuario.
 */
export const localeInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);
  const i18n = inject(I18nService);
  return next(req.clone({ setHeaders: { 'Accept-Language': i18n.locale() } }));
};
