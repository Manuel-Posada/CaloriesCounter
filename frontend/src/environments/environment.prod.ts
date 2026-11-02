export const environment = {
  production: true,
  // Backend Django en Modal (CPU) — se mantiene hasta que Render esté verificado.
  // Luego se cambia a 'https://caloriescounter-api.onrender.com/api'.
  apiUrl: 'https://manuel-posada--caloriescounter-api-django.modal.run/api',
  // El mismo cliente OAuth que en desarrollo; en Google Cloud hay que autorizar
  // https://caloriescounter.app y https://www.caloriescounter.app como orígenes JS.
  googleClientId: '294942063856-367nmu3ue5pcctgrlqk01ao10atu1q3p.apps.googleusercontent.com',
};
