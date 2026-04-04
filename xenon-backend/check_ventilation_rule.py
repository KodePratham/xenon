from __future__ import annotations

from pathlib import Path
import argparse
import ifcopenshell


def get_length_scale_to_meters(model) -> float:
    """Return length conversion factor from model units to meters."""
    projects = model.by_type("IfcProject")
    if not projects:
        return 1.0

    unit_assignment = getattr(projects[0], "UnitsInContext", None)
    if unit_assignment is None:
        return 1.0

    si_prefix_scale = {
        None: 1.0,
        "EXA": 1e18,
        "PETA": 1e15,
        "TERA": 1e12,
        "GIGA": 1e9,
        "MEGA": 1e6,
        "KILO": 1e3,
        "HECTO": 1e2,
        "DECA": 1e1,
        "DECI": 1e-1,
        "CENTI": 1e-2,
        "MILLI": 1e-3,
        "MICRO": 1e-6,
        "NANO": 1e-9,
    }

    for unit in unit_assignment.Units:
        if not unit.is_a("IfcSIUnit"):
            continue
        if getattr(unit, "UnitType", None) != "LENGTHUNIT":
            continue
        if getattr(unit, "Name", None) != "METRE":
            continue
        return si_prefix_scale.get(getattr(unit, "Prefix", None), 1.0)

    return 1.0


def get_area_quantity(entity, preferred_names: tuple[str, ...]) -> float | None:
    """Extract area-like quantity by name from IfcElementQuantity linked to an entity."""
    defined_by = getattr(entity, "IsDefinedBy", None) or []
    for rel in defined_by:
        if not rel.is_a("IfcRelDefinesByProperties"):
            continue
        prop_def = rel.RelatingPropertyDefinition
        if not prop_def or not prop_def.is_a("IfcElementQuantity"):
            continue

        for quantity in prop_def.Quantities:
            if not quantity.is_a("IfcPhysicalSimpleQuantity"):
                continue
            if getattr(quantity, "Name", "") not in preferred_names:
                continue
            area_value = getattr(quantity, "AreaValue", None)
            if area_value is not None and area_value > 0:
                return float(area_value)
    return None


def compute_room_floor_area(space) -> float | None:
    return get_area_quantity(space, ("NetFloorArea", "GrossFloorArea", "FloorArea"))


def compute_window_opening_area(window, length_scale_to_m: float) -> float | None:
    # Prefer explicit IFC quantities when available.
    quantity_area = get_area_quantity(window, ("Area", "NetArea", "GrossArea"))
    if quantity_area is not None:
        return quantity_area

    overall_height = getattr(window, "OverallHeight", None)
    overall_width = getattr(window, "OverallWidth", None)
    if overall_height and overall_width and overall_height > 0 and overall_width > 0:
        return float(overall_height) * float(overall_width) * (length_scale_to_m**2)

    return None


def evaluate_ventilation(ifc_path: Path) -> None:
    model = ifcopenshell.open(str(ifc_path))
    spaces = model.by_type("IfcSpace")
    windows = model.by_type("IfcWindow")
    length_scale_to_m = get_length_scale_to_meters(model)

    print(f"File: {ifc_path}")
    print(f"Schema: {model.schema}")
    print("Rule: total window opening area >= 10% of total room floor area")
    print(f"Rooms found (IfcSpace): {len(spaces)}")
    print(f"Windows found (IfcWindow): {len(windows)}")

    if not spaces and not windows:
        print("Status: No rooms and no windows found in the IFC file.")
        return
    if not spaces:
        print("Status: No rooms (IfcSpace) found in the IFC file.")
        return
    if not windows:
        print("Status: No windows (IfcWindow) found in the IFC file.")
        return

    room_areas: list[float] = []
    spaces_missing_area = 0
    for space in spaces:
        area = compute_room_floor_area(space)
        if area is None:
            spaces_missing_area += 1
            continue
        room_areas.append(area)

    window_areas: list[float] = []
    windows_missing_area = 0
    for window in windows:
        area = compute_window_opening_area(window, length_scale_to_m)
        if area is None:
            windows_missing_area += 1
            continue
        window_areas.append(area)

    total_room_area = sum(room_areas)
    total_window_area = sum(window_areas)

    if total_room_area <= 0:
        print("Status: Unable to evaluate rule because room floor area could not be determined.")
        print(f"Spaces missing area quantity: {spaces_missing_area} / {len(spaces)}")
        return

    if total_window_area <= 0:
        print("Status: Rule failed because total measurable window opening area is zero.")
        print(f"Windows missing area quantity/dimensions: {windows_missing_area} / {len(windows)}")
        return

    ventilation_percent = (total_window_area / total_room_area) * 100.0
    passes_rule = ventilation_percent >= 10.0

    print(f"Total room floor area: {total_room_area:.3f} m^2")
    print(f"Total window opening area: {total_window_area:.3f} m^2")
    print(f"Ventilation ratio: {ventilation_percent:.2f}%")
    print(f"Spaces missing area quantity: {spaces_missing_area} / {len(spaces)}")
    print(f"Windows missing area quantity/dimensions: {windows_missing_area} / {len(windows)}")
    print(f"Result: {'PASS' if passes_rule else 'FAIL'} (threshold: 10.00%)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check IFC model against a 10% natural ventilation rule (window area vs room floor area)."
    )
    parser.add_argument("ifc_file", help="Path to IFC file")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ifc_path = Path(args.ifc_file)
    if not ifc_path.exists():
        raise FileNotFoundError(f"IFC file not found: {ifc_path}")
    evaluate_ventilation(ifc_path)


if __name__ == "__main__":
    main()
