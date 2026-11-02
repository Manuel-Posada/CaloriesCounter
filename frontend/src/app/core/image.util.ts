/**
 * Reduce la foto a JPEG (lado mayor ≤ maxSide). Las fotos de móvil pesan 3-12 MB y el
 * pipeline de inferencia rechaza > 10 MB; además acelera la subida a R2.
 * `imageOrientation: 'from-image'` aplica la rotación EXIF.
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

