import { parse } from 'exifr';

/** EXIF lives in the first chunk of the file; no need to read 10 MB. */
const MAX_EXIF_BYTES = 256 * 1024;

/**
 * 35mm-equivalent focal length (EXIF tag `0xA405`) of the original photo.
 *
 * Must be read **before** compressing: re-encoding to JPEG via canvas strips EXIF, and without
 * this value the pipeline falls back to assuming a 65° FOV (a source of volume error).
 *
 * Watch out for the name: `exifr` maps the tag to `FocalLengthIn35mmFormat` (not `...Film`).
 *
 * Returns `null` if the format does not expose it (PNG, HEIC without EXIF, screenshots) or if
 * the camera does not write it; in that case the Settings FOV or default value is used.
 */
export async function readFocal35mm(file: Blob): Promise<number | null> {
  try {
    const head = file.size > MAX_EXIF_BYTES ? file.slice(0, MAX_EXIF_BYTES) : file;
    const exif = await parse(head, { pick: ['FocalLengthIn35mmFormat'] });
    const value = exif?.FocalLengthIn35mmFormat;
    return typeof value === 'number' && value > 0 ? value : null;
  } catch {
    // Unsupported format or corrupt EXIF: not an app error.
    return null;
  }
}
