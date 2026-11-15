"""Nutrition table (USDA CSV + density) and physical/math calculation.

    grams       = volume_cm3 * density_g_cm3
    total_value = (grams / 100) * value_per_100g
"""
import csv
import math
from dataclasses import dataclass
from pathlib import Path

from .config import NUM_CLASSES

COL_KCAL = "kcal_100g"
COL_PROTEIN = "Protein (g)"
COL_CARBS = "Carbohydrate, by difference (g)"
COL_FAT = "Total lipid (fat) (g)"

_IDX_CANDIDATES = ("idx", "class_idx", "class_id", "id", "index")
_NAME_CANDIDATES = (
    "name", "food", "food_name", "class_name", "nombre", "clase", "label", "description", "class", "food_class",
)
_DENSITY_CANDIDATES = ("densidad", "density", "densidad_g_cm3", "density_g_cm3", "densidad (g/cm3)")

DEFAULT_DENSITY_G_CM3 = 1.0


@dataclass(frozen=True)
class FoodRecord:
    idx: int
    name: str
    name_es: str
    density_g_cm3: float
    density_assumed: bool
    kcal_100g: float
    protein_100g: float
    carbs_100g: float
    fat_100g: float


def _num(value) -> float | None:
    if value is None:
        return None
    s = str(value).strip().replace(",", ".")
    if s == "" or s.lower() in {"na", "nan", "none", "null", "-"}:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return None if math.isnan(v) else v


def _find(columns: dict[str, str], candidates) -> str | None:
    for c in candidates:
        if c in columns:
            return columns[c]
    return None


class NutritionTable:
    def __init__(self, records: dict[int, FoodRecord]):
        self._records = records

    def __len__(self):
        return len(self._records)

    def __contains__(self, idx: int):
        return idx in self._records

    def get(self, idx: int) -> FoodRecord:
        return self._records[idx]

    @classmethod
    def load(cls, path: str | Path, expected_classes: int | None = NUM_CLASSES) -> "NutritionTable":
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            fieldnames = [f.strip() for f in (reader.fieldnames or [])]
            lower = {f.lower(): f for f in fieldnames}

            missing = [c for c in (COL_KCAL, COL_PROTEIN, COL_CARBS, COL_FAT) if c.lower() not in lower]
            if missing:
                raise ValueError(f"Missing nutritional columns in CSV: {missing}. Found: {fieldnames}")

            density_col = _find(lower, _DENSITY_CANDIDATES) or next(
                (orig for low, orig in lower.items() if "dens" in low), None
            )
            if density_col is None:
                raise ValueError(f"Density column not found. Columns: {fieldnames}")
            idx_col = _find(lower, _IDX_CANDIDATES)
            name_col = _find(lower, _NAME_CANDIDATES)

            records: dict[int, FoodRecord] = {}
            for row_number, raw in enumerate(reader):
                row = {k.strip(): v for k, v in raw.items() if k is not None}
                idx = int(float(row[idx_col])) if idx_col else row_number
                if idx in records:
                    raise ValueError(f"Duplicate idx in CSV: {idx}")

                density = _num(row.get(density_col))
                density_assumed = density is None or density <= 0
                name = (row.get(name_col) or "").strip() if name_col else f"class_{idx}"
                records[idx] = FoodRecord(
                    idx=idx,
                    name=name,
                    # Optional translation from CSV; falls back to original name if missing.
                    name_es=(row.get("nombre_es") or "").strip() or name,
                    density_g_cm3=DEFAULT_DENSITY_G_CM3 if density_assumed else density,
                    density_assumed=density_assumed,
                    kcal_100g=_num(row.get(COL_KCAL)) or 0.0,
                    protein_100g=_num(row.get(COL_PROTEIN)) or 0.0,
                    carbs_100g=_num(row.get(COL_CARBS)) or 0.0,
                    fat_100g=_num(row.get(COL_FAT)) or 0.0,
                )

        if expected_classes is not None and len(records) != expected_classes:
            raise ValueError(f"CSV has {len(records)} classes, expected {expected_classes}.")
        return cls(records)

    def compute(self, idx: int, volume_cm3: float) -> dict:
        """Apply volume-to-mass and nutrient scaling for a class."""
        r = self._records[idx]
        grams = volume_cm3 * r.density_g_cm3
        factor = grams / 100.0
        return {
            "nombre": r.name,
            "nombre_es": r.name_es,
            "densidad_g_cm3": r.density_g_cm3,
            "densidad_asumida": r.density_assumed,
            "peso_g": grams,
            "calorias_kcal": factor * r.kcal_100g,
            "proteinas_g": factor * r.protein_100g,
            "carbohidratos_g": factor * r.carbs_100g,
            "grasas_g": factor * r.fat_100g,
            # Table values (the CSV mapping) so the user can inspect them.
            "por_100g": {
                "calorias_kcal": r.kcal_100g,
                "proteinas_g": r.protein_100g,
                "carbohidratos_g": r.carbs_100g,
                "grasas_g": r.fat_100g,
            },
        }

