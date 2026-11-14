export const environment = {
  production: true,
  // Django backend on Render (free tier). GPU inference runs separately on Modal.
  apiUrl: 'https://caloriescounter-api.onrender.com/api',
  // Same OAuth client ID as dev; authorize https://caloriescounter.app and
  // https://www.caloriescounter.app as JavaScript origins in Google Cloud Console.
  googleClientId: '294942063856-367nmu3ue5pcctgrlqk01ao10atu1q3p.apps.googleusercontent.com',
};
