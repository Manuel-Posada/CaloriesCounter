export interface Macros {
  proteinas_g: number;
  carbohidratos_g: number;
  grasas_g: number;
}

/** Valores de la tabla nutricional, por 100 g (el "mapeo" del CSV). */
export interface NutritionPer100g {
  calorias_kcal: number;
  proteinas_g: number;
  carbohidratos_g: number;
  grasas_g: number;
}

/** Elemento de `alimentos` devuelto por el POST (pipeline de Modal). */
export interface DetectedFood {
  idx: number;
  nombre: string;
  /** Nombre traducido del CSV nutricional; puede faltar en un Modal antiguo. */
  nombre_es?: string;
  confianza: number;
  volumen_cm3: number;
  peso_g: number;
  densidad_g_cm3: number;
  /** `true` si el CSV no traía densidad y se asumió 1 g/cm³. */
  densidad_asumida?: boolean;
  /** `true` si el usuario fijó los gramos a mano. */
  peso_manual?: boolean;
  /** Valores extendidos por 100 g (minerales, vitaminas, grasas). */
  detalle?: Record<string, number>;
  /** Contorno de la zona segmentada, normalizado a 0..1 sobre la imagen. */
  poligono?: number[][];
  /** Centro de la zona segmentada, normalizado. */
  centroide?: [number, number] | null;
  nutricion: {
    calorias_kcal: number;
    proteinas_g: number;
    carbohidratos_g: number;
    grasas_g: number;
    /** Puede faltar con un Modal antiguo que aún no lo envía. */
    por_100g?: NutritionPer100g;
  };
}

/** Contorno guardado con el registro, para pintar las zonas en el historial. */
export interface FoodContour {
  nombre: string;
  kcal: number;
  /** Puntos [x, y] normalizados a 0..1 sobre la imagen. */
  poligono: number[][];
  centroide: [number, number] | null;
}

/** Entrada del catálogo de clases, para corregir un alimento mal clasificado. */
export interface CatalogFood {
  idx: number;
  nombre: string;
  nombre_es: string;
  por_100g: NutritionPer100g;
  densidad_g_cm3: number;
}

export interface FoodLog {
  id: number;
  id_imagen_r2: string;
  /** URL prefirmada de lectura; null cuando la imagen ya fue eliminada de R2 (>72 h). */
  imagen_url: string | null;
  fecha_hora: string;
  clases_detectadas: number[];
  volumen_estimado: number;
  calorias_totales: number;
  macronutrientes: Macros;
  consejo_nutricional: string;
  /** Inclinación de cámara estimada por el pipeline (grados respecto a la vertical). */
  angulo_camara_deg: number | null;
  /** Contornos por alimento; vacío cuando la imagen ya no existe. */
  contornos: FoodContour[];
  /** Peso total en gramos (suma del detalle por alimento). */
  peso_total: number;
  /** Diámetro del plato con el que se fijó la escala y su origen (plate/prior/raw). */
  plate_diameter_cm: number;
  escala_origen: 'plate' | 'prior' | 'raw';
  /** false en análisis antiguos, guardados antes de que existiera el detalle editable. */
  editable: boolean;
  imagen_eliminada_en: string | null;
}

/** Aviso del pipeline: código + parámetros, para traducirlo en el cliente. */
export interface PipelineWarning {
  code: string;
  params?: Record<string, string | number>;
}

/** Respuesta del POST /food-logs/: el registro + el detalle por alimento (no se persiste). */
export interface FoodLogCreated extends FoodLog {
  alimentos: DetectedFood[];
  /** Los strings sueltos vienen de un Modal antiguo que aún no emitía códigos. */
  advertencias: (string | PipelineWarning)[];
}

/** Detalle de un análisis guardado (GET /food-logs/:id/). */
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

/** GET /me/: perfil mínimo para el menú de cuenta. */
export interface UserProfile {
  email: string;
  first_name: string;
  last_name: string;
  /** Avatar de la cuenta de Google; cadena vacía si no hay. */
  picture_url: string;
  /** Habilita la sección de administración. */
  is_staff: boolean;
  /** Preferencias de interfaz guardadas en el perfil. */
  locale: 'es' | 'en';
  theme: 'system' | 'light' | 'dark';
  accent: 'green' | 'blue' | 'orange' | 'pink' | 'violet';
}

