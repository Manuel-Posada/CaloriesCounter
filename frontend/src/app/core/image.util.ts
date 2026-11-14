/**
 * Downscales the photo to JPEG (longest side ≤ maxSide). Mobile photos weigh 3-12 MB and the
 * inference pipeline rejects > 10 MB; this also speeds up the R2 upload.
 * `imageOrientation: 'from-image'` applies EXIF rotation.
 */
export async function compressImage(file: Blob, maxSide = 1280, quality = 0.85): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), 'image/jpeg', quality),
  );
}

