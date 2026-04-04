# IFC Workspace Bootstrap

This workspace is initialized for working with IFC files using Python and [IfcOpenShell](https://ifcopenshell.org/).

## Included

- `Ifc4_SampleHouse.ifc` sample model
- `inspect_ifc.py` quick IFC summary utility
- `requirements.txt` Python dependency list

## Prerequisites

- Python 3.10+ installed

## Install dependencies

```powershell
python -m pip install -r requirements.txt
```

If your machine uses a specific Python path, use that executable instead.

## Run the inspector

```powershell
python inspect_ifc.py
```

To inspect another IFC file:

```powershell
python inspect_ifc.py path\\to\\model.ifc
```

To change how many top entity types are shown:

```powershell
python inspect_ifc.py --list-types 30
```

## Check 10% ventilation rule

```powershell
python check_ventilation_rule.py path\\to\\model.ifc
```

What it checks:
- Total window opening area
- Total room floor area (from `IfcSpace` quantities)
- Pass/Fail against 10% threshold

Special cases handled:
- Reports when no rooms are present
- Reports when no windows are present
- Reports when measurable area data is missing

## What this gives you

- Confirms IFC schema
- Shows counts for core building entities
- Lists top IFC entity classes by frequency

This is a minimal starting point for geometry extraction, property set queries, and data export workflows.
