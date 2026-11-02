export const environment = {
  production: true,
  // Backend Django en Modal (CPU). Cuando api.caloriescounter.app apunte al endpoint,
  // cambia esta URL por 'https://api.caloriescounter.app/api'.
  apiUrl: 'https://manuel-posada--caloriescounter-api-django.modal.run/api',
  // El mismo cliente OAuth que en desarrollo; en Google Cloud hay que autorizar
  // https://caloriescounter.app y https://www.caloriescounter.app como orígenes JS.
  googleClientId: '294942063856-367nmu3ue5pcctgrlqk01ao10atu1q3p.apps.googleusercontent.com',
};
