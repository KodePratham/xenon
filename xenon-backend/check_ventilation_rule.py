from __future__ import annotations

from pathlib import Path
import argparse
import os
import smtplib
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage
import ifcopenshell


@dataclass
class VentilationReport:
    ifc_path: Path
    schema: str
    rooms_found: int
    windows_found: int
    total_room_area: float
    total_window_area: float
    ventilation_percent: float
    spaces_missing_area: int
    windows_missing_area: int
    status: str
    result: str
    threshold_percent: float = 10.0
    window_ids: list = None


def load_env_file(env_path: Path) -> None:
    """Load .env file values into process environment."""
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            os.environ[key] = value


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


def evaluate_ventilation(ifc_path: Path) -> VentilationReport:
    model = ifcopenshell.open(str(ifc_path))
    spaces = model.by_type("IfcSpace")
    windows = model.by_type("IfcWindow")
    length_scale_to_m = get_length_scale_to_meters(model)

    if not spaces and not windows:
        return VentilationReport(
            ifc_path=ifc_path,
            schema=model.schema,
            rooms_found=0,
            windows_found=0,
            total_room_area=0.0,
            total_window_area=0.0,
            ventilation_percent=0.0,
            spaces_missing_area=0,
            windows_missing_area=0,
            status="No rooms and no windows found in the IFC file.",
            result="FAIL",
            window_ids=[],
        )
    if not spaces:
        return VentilationReport(
            ifc_path=ifc_path,
            schema=model.schema,
            rooms_found=0,
            windows_found=len(windows),
            total_room_area=0.0,
            total_window_area=0.0,
            ventilation_percent=0.0,
            spaces_missing_area=0,
            windows_missing_area=0,
            status="No rooms (IfcSpace) found in the IFC file.",
            result="FAIL",
            window_ids=[w.id() for w in windows],
        )
    if not windows:
        return VentilationReport(
            ifc_path=ifc_path,
            schema=model.schema,
            rooms_found=len(spaces),
            windows_found=0,
            total_room_area=0.0,
            total_window_area=0.0,
            ventilation_percent=0.0,
            spaces_missing_area=0,
            windows_missing_area=0,
            status="No windows (IfcWindow) found in the IFC file.",
            result="FAIL",
            window_ids=[],
        )

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
        return VentilationReport(
            ifc_path=ifc_path,
            schema=model.schema,
            rooms_found=len(spaces),
            windows_found=len(windows),
            total_room_area=0.0,
            total_window_area=total_window_area,
            ventilation_percent=0.0,
            spaces_missing_area=spaces_missing_area,
            windows_missing_area=windows_missing_area,
            status="Unable to evaluate rule because room floor area could not be determined.",
            result="FAIL",
            window_ids=[w.id() for w in windows],
        )

    if total_window_area <= 0:
        return VentilationReport(
            ifc_path=ifc_path,
            schema=model.schema,
            rooms_found=len(spaces),
            windows_found=len(windows),
            total_room_area=total_room_area,
            total_window_area=0.0,
            ventilation_percent=0.0,
            spaces_missing_area=spaces_missing_area,
            windows_missing_area=windows_missing_area,
            status="Rule failed because total measurable window opening area is zero.",
            result="FAIL",
            window_ids=[w.id() for w in windows],
        )

    ventilation_percent = (total_window_area / total_room_area) * 100.0
    passes_rule = ventilation_percent >= 10.0

    return VentilationReport(
        ifc_path=ifc_path,
        schema=model.schema,
        rooms_found=len(spaces),
        windows_found=len(windows),
        total_room_area=total_room_area,
        total_window_area=total_window_area,
        ventilation_percent=ventilation_percent,
        spaces_missing_area=spaces_missing_area,
        windows_missing_area=windows_missing_area,
        status="Evaluation completed successfully.",
        result="PASS" if passes_rule else "FAIL",
        window_ids=[w.id() for w in windows],
    )


def report_to_text(report: VentilationReport) -> str:
    lines = [
        f"File: {report.ifc_path}",
        f"Schema: {report.schema}",
        "Rule: total window opening area >= 10% of total room floor area",
        f"Rooms found (IfcSpace): {report.rooms_found}",
        f"Windows found (IfcWindow): {report.windows_found}",
        f"Status: {report.status}",
        f"Total room floor area: {report.total_room_area:.3f} m^2",
        f"Total window opening area: {report.total_window_area:.3f} m^2",
        f"Ventilation ratio: {report.ventilation_percent:.2f}%",
        f"Spaces missing area quantity: {report.spaces_missing_area} / {report.rooms_found}",
        f"Windows missing area quantity/dimensions: {report.windows_missing_area} / {report.windows_found}",
        f"Result: {report.result} (threshold: {report.threshold_percent:.2f}%)",
    ]
    return "\n".join(lines)


def report_to_html(report: VentilationReport, generated_at: str) -> str:
    result_color = "#1f7a1f" if report.result == "PASS" else "#b30000"
    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Ventilation Rule Report</title>
  </head>
  <body style="font-family: 'Segoe UI', Arial, sans-serif; background:#f6f8fb; margin:0; padding:24px; color:#1f2937;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      <tr>
        <td align="center">
          <table role="presentation" width="720" cellspacing="0" cellpadding="0" style="max-width:720px; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
            <tr>
              <td style="padding:22px 28px; background:#0f172a; color:#ffffff;">
                <h1 style="margin:0; font-size:20px;">Ventilation Rule Compliance Report</h1>
                <p style="margin:8px 0 0 0; font-size:13px; color:#cbd5e1;">Generated at {generated_at}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 14px 0; font-size:15px;"><strong>Overall Result:</strong> <span style="color:{result_color}; font-weight:700;">{report.result}</span></p>
                <p style="margin:0 0 20px 0; font-size:14px; color:#374151;">{report.status}</p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; font-size:14px;">
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc; width:45%;"><strong>IFC File</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.ifc_path}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc;"><strong>Schema</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.schema}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc;"><strong>Rooms Found (IfcSpace)</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.rooms_found}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc;"><strong>Windows Found (IfcWindow)</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.windows_found}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc;"><strong>Total Room Floor Area</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.total_room_area:.3f} m^2</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc;"><strong>Total Window Opening Area</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.total_window_area:.3f} m^2</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc;"><strong>Ventilation Ratio</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.ventilation_percent:.2f}% (threshold {report.threshold_percent:.2f}%)</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc;"><strong>Spaces Missing Area</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.spaces_missing_area} / {report.rooms_found}</td>
                  </tr>
                  <tr>
                    <td style="padding:10px; border:1px solid #e5e7eb; background:#f8fafc;"><strong>Windows Missing Area</strong></td>
                    <td style="padding:10px; border:1px solid #e5e7eb;">{report.windows_missing_area} / {report.windows_found}</td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def parse_recipients(raw_recipients: list[str]) -> list[str]:
    recipients: list[str] = []
    for item in raw_recipients:
        recipients.extend([email.strip() for email in item.split(",") if email.strip()])
    return recipients


def send_report_email(report: VentilationReport, args: argparse.Namespace) -> None:
    recipients = parse_recipients(args.email_to)
    if not recipients:
        raise ValueError("At least one recipient email is required. Use --email-to or REPORT_RECIPIENTS.")

    if not args.smtp_username:
        raise ValueError("SMTP username is required. Use --smtp-username or SMTP_USERNAME.")

    if not args.smtp_password:
        raise ValueError("SMTP password is required. Use --smtp-password or SMTP_PASSWORD.")

    from_email = args.from_email or args.smtp_username
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    subject = f"{args.email_subject_prefix} | {report.result} | {report.ifc_path.name}"

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_email
    message["To"] = ", ".join(recipients)
    message.set_content(report_to_text(report))
    message.add_alternative(report_to_html(report, generated_at), subtype="html")

    with smtplib.SMTP(args.smtp_host, args.smtp_port, timeout=30) as smtp:
        smtp.ehlo()
        if args.smtp_use_starttls:
            smtp.starttls()
            smtp.ehlo()
        smtp.login(args.smtp_username, args.smtp_password)
        smtp.send_message(message)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check IFC model against a 10% natural ventilation rule (window area vs room floor area)."
    )
    parser.add_argument("ifc_file", help="Path to IFC file")
    parser.add_argument("--smtp-host", default=os.getenv("SMTP_HOST", "smtp.gmail.com"), help="SMTP host")
    parser.add_argument(
        "--smtp-port",
        type=int,
        default=int(os.getenv("SMTP_PORT", "587")),
        help="SMTP port",
    )
    parser.add_argument(
        "--smtp-username",
        default=os.getenv("SMTP_USERNAME"),
        help="SMTP username (for Gmail, your full gmail address)",
    )
    parser.add_argument(
        "--smtp-password",
        default=os.getenv("SMTP_PASSWORD"),
        help="SMTP password or app password",
    )
    parser.add_argument(
        "--from-email",
        default=os.getenv("SMTP_FROM_EMAIL"),
        help="Sender email. Defaults to SMTP username if omitted.",
    )
    parser.add_argument(
        "--email-to",
        nargs="+",
        default=(os.getenv("REPORT_RECIPIENTS", "").split(",") if os.getenv("REPORT_RECIPIENTS") else []),
        help="One or more recipient addresses (space-separated and/or comma-separated)",
    )
    parser.add_argument(
        "--email-subject-prefix",
        default=os.getenv("REPORT_SUBJECT_PREFIX", "Xenon Ventilation Report"),
        help="Prefix used in the email subject",
    )
    parser.add_argument(
        "--smtp-use-starttls",
        action=argparse.BooleanOptionalAction,
        default=(os.getenv("SMTP_USE_STARTTLS", "true").lower() in {"1", "true", "yes", "y"}),
        help="Enable STARTTLS for SMTP connection (recommended)",
    )
    return parser.parse_args()


def main() -> None:
    load_env_file(Path(__file__).with_name(".env"))
    args = parse_args()
    ifc_path = Path(args.ifc_file)
    if not ifc_path.exists():
        raise FileNotFoundError(f"IFC file not found: {ifc_path}")

    report = evaluate_ventilation(ifc_path)
    print(report_to_text(report))
    send_report_email(report, args)
    print(f"Email report sent to: {', '.join(parse_recipients(args.email_to))}")


if __name__ == "__main__":
    main()
