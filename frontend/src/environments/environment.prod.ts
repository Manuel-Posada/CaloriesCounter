export const environment = {
  production: true,
  // Backend Django en Render (plan free). La inferencia (GPU) sigue en Modal.
  apiUrl: 'https://caloriescounter-api.onrender.com/api',
  // El mismo cliente OAuth que en desarrollo; en Google Cloud hay que autorizar
  // https://caloriescounter.app y https://www.caloriescounter.app como orígenes JS.
  googleClientId: '294942063856-367nmu3ue5pcctgrlqk01ao10atu1q3p.apps.googleusercontent.com',
};
