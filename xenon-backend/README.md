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

The script now sends a professional email report (PASS/FAIL + detailed metrics) every time it runs.

### Quick SMTP configuration with `.env` (recommended)

1. Copy `.env.example` to `.env`.
2. Fill your real Gmail/app-password/recipient values.

Example `.env`:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USE_STARTTLS=true
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_16_char_app_password
REPORT_RECIPIENTS=alice@example.com,bob@example.com
```

Then run:

```powershell
python check_ventilation_rule.py .\\sample1.ifc
```

You can also pass values via CLI flags:

```powershell
python check_ventilation_rule.py .\\sample1.ifc --email-to alice@example.com bob@example.com --smtp-username your_email@gmail.com --smtp-password your_16_char_app_password
```

For complete Gmail setup instructions (2FA + App Password), see `GMAIL_SMTP_SETUP.md`.

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
