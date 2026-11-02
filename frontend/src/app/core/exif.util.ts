import { parse } from 'exifr';

/** El EXIF vive en el primer bloque del fichero; no hace falta leer 10 MB. */
const MAX_EXIF_BYTES = 256 * 1024;

/**
 * Focal equivalente en 35 mm (tag EXIF `0xA405`) de la foto original.
 *
 * Hay que leerla **antes** de comprimir: el re-encode a JPEG con canvas borra el EXIF, y sin
 * este dato el pipeline tiene que asumir un FOV de 65° (fuente de error en el volumen).
 *
 * Ojo con el nombre: `exifr` traduce el tag a `FocalLengthIn35mmFormat` (no `…Film`).
 *
 * Devuelve `null` si el formato no la expone (PNG, HEIC sin EXIF, capturas de pantalla) o si
 * la cámara no la escribe; en ese caso se usa el FOV de Configuración o el valor por defecto.
 */
export async function readFocal35mm(file: Blob): Promise<number | null> {
  try {
    const head = file.size > MAX_EXIF_BYTES ? file.slice(0, MAX_EXIF_BYTES) : file;
    const exif = await parse(head, { pick: ['FocalLengthIn35mmFormat'] });
    const value = exif?.FocalLengthIn35mmFormat;
    return typeof value === 'number' && value > 0 ? value : null;
  } catch {
    // Formato no soportado o EXIF corrupto: no es un error de la app.
    return null;
  }
}
