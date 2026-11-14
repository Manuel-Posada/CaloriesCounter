export interface Macros {
  proteinas_g: number;
  carbohidratos_g: number;
  grasas_g: number;
}

/** Nutrition table values per 100 g (from the CSV mapping). */
export interface NutritionPer100g {
  calorias_kcal: number;
  proteinas_g: number;
  carbohidratos_g: number;
  grasas_g: number;
}

/** Item in `alimentos` returned by the POST endpoint (Modal pipeline). */
export interface DetectedFood {
  idx: number;
  nombre: string;
  /** Translated name from the nutrition CSV; may be missing from an older Modal response. */
  nombre_es?: string;
  confianza: number | null;
  volumen_cm3: number;
  peso_g: number;
  densidad_g_cm3: number;
  /** `true` if the CSV had no density and 1 g/cm³ was assumed. */
  densidad_asumida?: boolean;
  /** `true` if the user manually set the grams. */
  peso_manual?: boolean;
  /** `true` if the user changed the class: no longer counts as classifier uncertainty. */
  clase_editada?: boolean;
  /** Extended values per 100 g (minerals, vitamins, fats). */
  detalle?: Record<string, number>;
  /** Segmented region contour, normalized to 0..1 over the image. */
  poligono?: number[][];
  /** Segmented region center, normalized. */
  centroide?: [number, number] | null;
  nutricion: {
    calorias_kcal: number;
    proteinas_g: number;
    carbohidratos_g: number;
    grasas_g: number;
    /** May be missing from an older Modal response that does not send it yet. */
    por_100g?: NutritionPer100g;
  };
}

/** Contour saved with the log, used to draw regions in history. */
export interface FoodContour {
  nombre: string;
  kcal: number;
  /** [x, y] points normalized to 0..1 over the image. */
  poligono: number[][];
  centroide: [number, number] | null;
}

/** Class catalog entry, used to correct a misclassified food item. */
export interface CatalogFood {
  idx: number;
  nombre: string;
  nombre_es: string;
  por_100g: NutritionPer100g;
  densidad_g_cm3: number;
}

/** Analysis confidence level (computed server-side from scale, tilt, and classifier). */
export interface Confidence {
  score: number;
  nivel: 'alta' | 'media' | 'baja';
  /** Reason codes that lower confidence (`escala_supuesta`, `clasificacion_baja`…). */
  motivos: string[];
}

export interface FoodLog {
  id: number;
  id_imagen_r2: string;
  /** Presigned read URL; null when the image has already been deleted from R2 (>72 h). */
  imagen_url: string | null;
  fecha_hora: string;
  clases_detectadas: number[];
  volumen_estimado: number;
  calorias_totales: number;
  macronutrientes: Macros;
  consejo_nutricional: string;
  /** Camera tilt estimated by the pipeline (degrees from vertical). */
  angulo_camara_deg: number | null;
  /** Contours per food item; empty when the image no longer exists. */
  contornos: FoodContour[];
  /** Total weight in grams (sum of per-food breakdown). */
  peso_total: number;
  /** Plate diameter used to set the scale and its source (plate/prior/raw). */
  plate_diameter_cm: number;
  escala_origen: 'plate' | 'prior' | 'raw';
  /** false in older analyses saved before the editable breakdown existed. */
  editable: boolean;
  /** Pipeline warnings; bare strings come from an older Modal response. */
  advertencias: (string | PipelineWarning)[];
  /** May be missing in analyses saved before this calculation existed. */
  confianza?: Confidence;
  imagen_eliminada_en: string | null;
}

/** Pipeline warning: code + parameters, for client-side translation. */
export interface PipelineWarning {
  code: string;
  params?: Record<string, string | number>;
}

/** Response from POST /food-logs/: the log + per-food breakdown (not persisted). */
export interface FoodLogCreated extends FoodLog {
  alimentos: DetectedFood[];
}

/** Saved analysis detail (GET /food-logs/:id/). */
export interface FoodLogDetail extends FoodLog {
  alimentos: DetectedFood[];
}

export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface PresignResponse {
  upload_url: string;
  id_imagen_r2: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_in: number;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

/** GET /me/: minimal profile for the account menu. */
export interface UserProfile {
  email: string;
  first_name: string;
  last_name: string;
  /** Google account avatar; empty string if none. */
  picture_url: string;
  /** Enables the admin section. */
  is_staff: boolean;
  /** UI preferences saved in the profile. */
  locale: 'es' | 'en';
  theme: 'system' | 'light' | 'dark';
  accent: 'green' | 'blue' | 'orange' | 'pink' | 'violet';
}

