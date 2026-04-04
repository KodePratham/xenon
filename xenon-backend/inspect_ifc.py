from __future__ import annotations

from pathlib import Path
import argparse
import ifcopenshell


def inspect_ifc(ifc_path: Path, list_types: int) -> None:
    model = ifcopenshell.open(str(ifc_path))

    project = model.by_type("IfcProject")
    site = model.by_type("IfcSite")
    building = model.by_type("IfcBuilding")
    storeys = model.by_type("IfcBuildingStorey")
    products = model.by_type("IfcProduct")
    walls = model.by_type("IfcWall") + model.by_type("IfcWallStandardCase")
    slabs = model.by_type("IfcSlab")
    doors = model.by_type("IfcDoor")
    windows = model.by_type("IfcWindow")

    print(f"File: {ifc_path}")
    print(f"Schema: {model.schema}")
    print(f"IfcProject count: {len(project)}")
    print(f"IfcSite count: {len(site)}")
    print(f"IfcBuilding count: {len(building)}")
    print(f"IfcBuildingStorey count: {len(storeys)}")
    print(f"IfcProduct count: {len(products)}")
    print(f"Walls count: {len(walls)}")
    print(f"Slabs count: {len(slabs)}")
    print(f"Doors count: {len(doors)}")
    print(f"Windows count: {len(windows)}")

    if list_types > 0:
        print("\nTop IFC entity classes by count:")
        type_counts: dict[str, int] = {}
        for element in model:
            type_name = element.is_a()
            type_counts[type_name] = type_counts.get(type_name, 0) + 1

        top = sorted(type_counts.items(), key=lambda item: item[1], reverse=True)[:list_types]
        for name, count in top:
            print(f"- {name}: {count}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect and summarize an IFC file")
    parser.add_argument(
        "ifc_file",
        nargs="?",
        default="Ifc4_SampleHouse.ifc",
        help="Path to IFC file (default: Ifc4_SampleHouse.ifc)",
    )
    parser.add_argument(
        "--list-types",
        type=int,
        default=15,
        help="Show top N IFC entity classes by count (default: 15)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    ifc_path = Path(args.ifc_file)

    if not ifc_path.exists():
        raise FileNotFoundError(f"IFC file not found: {ifc_path}")

    inspect_ifc(ifc_path, list_types=args.list_types)


if __name__ == "__main__":
    main()
