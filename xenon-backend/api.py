from __future__ import annotations

import os
import json
import asyncio
import base64
import math
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from types import SimpleNamespace

import ifcopenshell
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from check_ventilation_rule import (
    VentilationReport,
    evaluate_ventilation,
    load_env_file,
    parse_recipients,
    report_to_text,
    send_report_email,
)


_ENV_PATH = Path(__file__).with_name(".env")
_FIXED_OUTPUT_DIR = Path(__file__).with_name("generated_fixes")
_AI_FIX_TARGET_PERCENT = 11.0


def read_env_direct(key: str, default: str = "") -> str:
    """Read a value directly from the .env file on disk, bypassing os.environ.
    This avoids stale values cached from server startup or --reload."""
    if not _ENV_PATH.exists():
        return os.getenv(key, default)
    for raw_line in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k.strip() == key:
            return v.strip().strip("\"'")
    return os.getenv(key, default)


app = FastAPI(title="Xenon IFC Ventilation API", version="1.0.0")


def build_smtp_args(final_recipients: list[str], email_subject_prefix: str) -> SimpleNamespace:
    """Build SMTP/email arguments from current on-disk .env values."""
    smtp_user = read_env_direct("SMTP_USERNAME")
    smtp_pass = read_env_direct("SMTP_PASSWORD")
    smtp_host = read_env_direct("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(read_env_direct("SMTP_PORT", "587"))
    smtp_from = read_env_direct("SMTP_FROM_EMAIL") or smtp_user
    smtp_starttls = read_env_direct("SMTP_USE_STARTTLS", "true").lower() in {"1", "true", "yes", "y"}

    return SimpleNamespace(
        email_to=final_recipients,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        smtp_username=smtp_user,
        smtp_password=smtp_pass,
        from_email=smtp_from,
        email_subject_prefix=email_subject_prefix,
        smtp_use_starttls=smtp_starttls,
    )


def report_from_payload(payload: dict, source_filename: str = "upload.ifc") -> VentilationReport:
    """Reconstruct report dataclass from JSON payload returned by /analyze."""
    return VentilationReport(
        ifc_path=Path(source_filename),
        schema=str(payload.get("schema", "UNKNOWN")),
        rooms_found=int(payload.get("rooms_found", 0)),
        windows_found=int(payload.get("windows_found", 0)),
        total_room_area=float(payload.get("total_room_area", 0.0)),
        total_window_area=float(payload.get("total_window_area", 0.0)),
        ventilation_percent=float(payload.get("ventilation_percent", 0.0)),
        spaces_missing_area=int(payload.get("spaces_missing_area", 0)),
        windows_missing_area=int(payload.get("windows_missing_area", 0)),
        status=str(payload.get("status", "Evaluation completed.")),
        result=str(payload.get("result", "FAIL")),
        threshold_percent=float(payload.get("threshold_percent", 10.0)),
        window_ids=list(payload.get("window_ids") or []),
    )


def _safe_ifc_value(value):
    """Convert IFC values into JSON-safe structures."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    # ifcopenshell entity instance
    if hasattr(value, "is_a") and hasattr(value, "id"):
        name = ""
        try:
            name = value.Name
        except Exception:
            name = ""
        return {
            "ref": value.id(),
            "type": value.is_a(),
            "name": name,
        }

    if isinstance(value, (list, tuple)):
        return [_safe_ifc_value(item) for item in value]

    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")

    return str(value)


def extract_ifc_json(ifc_path: Path, max_entities: int = 1500) -> dict:
    model = ifcopenshell.open(str(ifc_path))
    entities = model.by_type("IfcRoot")
    extracted = []

    for entity in entities[:max_entities]:
        item = {
            "id": entity.id(),
            "type": entity.is_a(),
            "global_id": getattr(entity, "GlobalId", None),
            "name": getattr(entity, "Name", None),
            "description": getattr(entity, "Description", None),
            "attributes": {},
        }

        for index, attr_name in enumerate(entity.attribute_name(i) for i in range(len(entity))):
            try:
                value = entity[index]
            except Exception:
                value = None
            item["attributes"][attr_name] = _safe_ifc_value(value)

        extracted.append(item)

    type_counts: dict[str, int] = {}
    for entity in entities:
        entity_type = entity.is_a()
        type_counts[entity_type] = type_counts.get(entity_type, 0) + 1

    return {
        "source_filename": ifc_path.name,
        "schema": model.schema,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_root_entities": len(entities),
        "included_entities": len(extracted),
        "truncated": len(entities) > max_entities,
        "max_entities": max_entities,
        "entity_type_counts": dict(sorted(type_counts.items(), key=lambda kv: kv[0])),
        "entities": extracted,
    }


async def generate_suggestions(report) -> list[dict]:
    """Generate LLM actionable suggestions based on report data using Gemini API."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        # Fallback: force-read .env dynamically so the user doesn't even need to restart the server!
        env_path = Path(__file__).with_name(".env")
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("GEMINI_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip("\"'")
                    break

    if not api_key:
        return [{
            "type": "error",
            "title": "AI Suggestions Unavailable",
            "detail": "GEMINI_API_KEY is not set in the .env file. Please add it to enable real AI suggestions."
        }]

    # Provide the report as context to the LLM
    context = (
        f"You are an expert AI architect analyzing a building's ventilation compliance report.\n"
        f"Rule Result: {report.result}\n"
        f"Ventilation Ratio: {report.ventilation_percent}%\n"
        f"Rooms Found: {report.rooms_found} (Total Area: {report.total_room_area})\n"
        f"Windows Found: {report.windows_found} (Total Area: {report.total_window_area})\n"
        f"Missing Room Areas: {report.spaces_missing_area}\n"
        f"Missing Window Areas: {report.windows_missing_area}\n\n"
        "Analyze this data and generate 1 to 3 actionable suggestions to improve compliance or resolve missing geometric data. "
        "Return ONLY a raw JSON array. DO NOT use markdown code blocks or add any conversational text. "
        "The objects in the array MUST strictly match this schema exactly:\n"
        "[ { \"type\": \"success\" | \"critical\" | \"warning\" | \"action\" | \"info\", \"title\": \"Short Title\", \"detail\": \"Detailed explanation\" } ]\n"
    )

    data = {
        "contents": [{"parts": [{"text": context}]}]
    }
    
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    headers = {"Content-Type": "application/json"}
    req = urllib.request.Request(url, data=json.dumps(data).encode("utf-8"), headers=headers, method="POST")

    def _make_request():
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return response.read()
        except Exception as e:
            return e

    try:
        response_data = await asyncio.to_thread(_make_request)
        if isinstance(response_data, Exception):
            raise response_data
            
        resp_json = json.loads(response_data.decode("utf-8"))
        text_content = resp_json["candidates"][0]["content"]["parts"][0]["text"].strip()
        
        # Clean markdown code blocks if the LLM disobeyed
        if text_content.startswith("```json"):
            text_content = text_content[7:]
        elif text_content.startswith("```"):
            text_content = text_content[3:]
            
        if text_content.endswith("```"):
            text_content = text_content[:-3]
            
        text_content = text_content.strip()

        # Parse the JSON array
        suggestions = json.loads(text_content)
        if isinstance(suggestions, list):
            return suggestions
        else:
            raise ValueError("LLM did not return a JSON array.")
            
    except Exception as e:
        return [{
            "type": "error",
            "title": "AI Service Failed",
            "detail": f"Could not generate suggestions from LLM: {str(e)}"
        }]


def _extract_first_json_object(raw_text: str) -> dict | None:
    text = (raw_text or "").strip()
    if not text:
        return None

    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()

    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
        return None
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        return None
    return None


def _compute_required_area_scale(report: VentilationReport, target_percent: float | None = None) -> float:
    target = float(target_percent if target_percent is not None else report.threshold_percent)
    if report.total_room_area <= 0 or report.total_window_area <= 0:
        return 1.25
    target_window_area = target / 100.0 * report.total_room_area
    if target_window_area <= report.total_window_area:
        return 1.0
    return target_window_area / report.total_window_area


async def _propose_window_area_scale_with_groq(report: VentilationReport, window_ids: list[int]) -> tuple[float | None, str | None]:
    api_key = read_env_direct("GROQ_API_KEY") or os.getenv("GROQ_API_KEY")
    if not api_key:
        return None, "GROQ_API_KEY is not configured"

    model = read_env_direct("GROQ_MODEL", "llama-3.3-70b-versatile")
    minimum_scale = _compute_required_area_scale(report, target_percent=_AI_FIX_TARGET_PERCENT)
    prompt = (
        "You are optimizing IFC ventilation compliance by only resizing windows. "
        "Return JSON only with this schema: "
        '{"window_area_scale": number, "reason": string}. '
        "Rules: window_area_scale must be >= 1.0 and <= 6.0. "
        "Do not reduce below the minimum required value. "
        f"Current ventilation percent: {report.ventilation_percent:.3f}. "
        f"Threshold percent: {report.threshold_percent:.3f}. "
        f"Target post-fix ventilation percent: {_AI_FIX_TARGET_PERCENT:.3f}. "
        f"Rooms found: {report.rooms_found}. Windows found: {report.windows_found}. "
        f"Current total room area: {report.total_room_area:.6f}. "
        f"Current total window area: {report.total_window_area:.6f}. "
        f"Minimum required window_area_scale to pass: {minimum_scale:.6f}. "
        f"Window entity IDs: {window_ids[:200]}. "
        "Choose a practical value with minimal geometry distortion while aiming to pass."
    )

    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You output strict JSON only."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "max_tokens": 300,
    }

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    def _request_once():
        with urllib.request.urlopen(req, timeout=60) as response:
            return response.read()

    try:
        raw = await asyncio.to_thread(_request_once)
        parsed = json.loads(raw.decode("utf-8"))
        text = parsed["choices"][0]["message"]["content"]
        extracted = _extract_first_json_object(text)
        if not extracted:
            return None, "Groq response did not contain a valid JSON object"
        value = float(extracted.get("window_area_scale"))
        if not math.isfinite(value):
            return None, "Groq scale value was not finite"
        return value, None
    except Exception as exc:
        return None, f"Groq request failed: {type(exc).__name__}: {exc}"


def _scale_window_geometry(window, dimension_scale: float, area_scale: float) -> bool:
    changed = False

    overall_height = getattr(window, "OverallHeight", None)
    overall_width = getattr(window, "OverallWidth", None)
    try:
        if overall_height and float(overall_height) > 0:
            window.OverallHeight = float(overall_height) * dimension_scale
            changed = True
    except Exception:
        pass
    try:
        if overall_width and float(overall_width) > 0:
            window.OverallWidth = float(overall_width) * dimension_scale
            changed = True
    except Exception:
        pass

    defined_by = getattr(window, "IsDefinedBy", None) or []
    for rel in defined_by:
        if not rel.is_a("IfcRelDefinesByProperties"):
            continue
        prop_def = rel.RelatingPropertyDefinition
        if not prop_def or not prop_def.is_a("IfcElementQuantity"):
            continue

        for quantity in prop_def.Quantities:
            if not quantity.is_a("IfcPhysicalSimpleQuantity"):
                continue

            area_value = getattr(quantity, "AreaValue", None)
            if area_value is not None:
                try:
                    quantity.AreaValue = float(area_value) * area_scale
                    changed = True
                except Exception:
                    pass

            length_value = getattr(quantity, "LengthValue", None)
            if length_value is not None:
                try:
                    quantity.LengthValue = float(length_value) * dimension_scale
                    changed = True
                except Exception:
                    pass

    return changed


async def create_ai_fixed_ifc(input_path: Path, original_report: VentilationReport) -> dict:
    model = ifcopenshell.open(str(input_path))
    windows = model.by_type("IfcWindow")
    if not windows:
        raise ValueError("No IfcWindow elements found. Unable to run AI fix.")

    # Keep evaluation logic unchanged (10% threshold) but push AI fixes to 11% for margin.
    minimum_area_scale = _compute_required_area_scale(
        original_report,
        target_percent=_AI_FIX_TARGET_PERCENT,
    )
    groq_scale, groq_error = await _propose_window_area_scale_with_groq(
        original_report,
        [w.id() for w in windows],
    )

    # Keep Groq in the loop, but guarantee we attempt a meaningful fix even if AI fails.
    proposed_scale = groq_scale if groq_scale is not None else minimum_area_scale
    if not math.isfinite(proposed_scale):
        proposed_scale = minimum_area_scale
    # Small safety margin so numerical/rounding effects still land above 11%.
    minimum_with_buffer = minimum_area_scale * 1.02
    area_scale = min(max(proposed_scale, minimum_with_buffer, 1.0), 6.0)
    dimension_scale = math.sqrt(area_scale)

    changed_windows: list[int] = []
    for window in windows:
        if _scale_window_geometry(window, dimension_scale=dimension_scale, area_scale=area_scale):
            changed_windows.append(window.id())

    if not changed_windows:
        raise ValueError("AI fix could not update any window dimensions or quantities.")

    _FIXED_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    output_name = f"{input_path.stem}-ai-fixed-{timestamp}.ifc"
    output_path = _FIXED_OUTPUT_DIR / output_name
    model.write(str(output_path))

    return {
        "output_path": output_path,
        "output_name": output_name,
        "changed_window_ids": changed_windows,
        "window_area_scale": area_scale,
        "window_dimension_scale": dimension_scale,
        "target_percent": _AI_FIX_TARGET_PERCENT,
        "groq_used": groq_scale is not None,
        "groq_error": groq_error,
    }

# Dev-friendly CORS so the static frontend can call this API from any local host/port.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    load_env_file(Path(__file__).with_name(".env"))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/debug-smtp")
def debug_smtp() -> dict:
    """Debug: shows exactly what credentials the server reads from .env right now."""
    return {
        "env_path": str(_ENV_PATH),
        "env_exists": _ENV_PATH.exists(),
        "smtp_username": read_env_direct("SMTP_USERNAME"),
        "smtp_password_length": len(read_env_direct("SMTP_PASSWORD")),
        "smtp_password_last4": read_env_direct("SMTP_PASSWORD")[-4:],
        "smtp_host": read_env_direct("SMTP_HOST", "smtp.gmail.com"),
        "smtp_port": read_env_direct("SMTP_PORT", "587"),
        "recipients": read_env_direct("REPORT_RECIPIENTS"),
    }


@app.post("/analyze")
async def analyze_ifc(
    file: UploadFile = File(...),
    recipients: str = Form(""),
    email_subject_prefix: str = Form("Xenon Ventilation Report"),
    send_email: bool = Form(True),
) -> dict:
    if file is None:
        raise HTTPException(status_code=400, detail="Please upload a file.")

    temp_path: Path | None = None
    try:
        payload = await file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        upload_name = (file.filename or "upload.ifc").strip() or "upload.ifc"
        suffix = Path(upload_name).suffix or ".ifc"
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(payload)
            temp_path = Path(temp_file.name)

        try:
            report = evaluate_ventilation(temp_path)
        except Exception as parse_exc:
            raise HTTPException(
                status_code=400,
                detail=f"Uploaded file could not be parsed as IFC: {parse_exc}",
            ) from parse_exc

        email_sent = False
        email_error = None
        final_recipients: list[str] = []
        if send_email:
            env_recipients = read_env_direct("REPORT_RECIPIENTS")

            raw_recipients: list[str] = []
            if recipients.strip():
                raw_recipients.append(recipients)
            elif env_recipients:
                raw_recipients.append(env_recipients)

            final_recipients = parse_recipients(raw_recipients)
            smtp_args = build_smtp_args(final_recipients, email_subject_prefix)

            if not final_recipients:
                email_error = "No recipients — enter email addresses in the frontend or set REPORT_RECIPIENTS in .env"
            elif not smtp_args.smtp_username or not smtp_args.smtp_password:
                email_error = "SMTP not configured — set SMTP_USERNAME and SMTP_PASSWORD in .env"
            else:
                try:
                    send_report_email(report, smtp_args)
                    email_sent = True
                except Exception as e:
                    email_error = f"SMTP send failed: {type(e).__name__}: {e}"

        suggestions = await generate_suggestions(report)

        return {
            "ok": True,
            "email_sent_to": final_recipients if email_sent else [],
            "email_error": email_error,
            "report_text": report_to_text(report),
            "suggestions": suggestions,
            "report": {
                "schema": report.schema,
                "rooms_found": report.rooms_found,
                "windows_found": report.windows_found,
                "total_room_area": round(report.total_room_area, 3),
                "total_window_area": round(report.total_window_area, 3),
                "ventilation_percent": round(report.ventilation_percent, 2),
                "spaces_missing_area": report.spaces_missing_area,
                "windows_missing_area": report.windows_missing_area,
                "status": report.status,
                "result": report.result,
                "threshold_percent": report.threshold_percent,
                "source_filename": upload_name,
                "window_ids": report.window_ids,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


@app.post("/send-email")
async def send_email(
    report_json: str = Form(...),
    recipients: str = Form(""),
    email_subject_prefix: str = Form("Xenon Ventilation Report"),
    source_filename: str = Form("upload.ifc"),
    screenshot: UploadFile | None = File(None),
) -> dict:
    try:
        parsed = json.loads(report_json)
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=400, detail="report_json must be a JSON object.")

        report = report_from_payload(parsed, source_filename=source_filename)

        env_recipients = read_env_direct("REPORT_RECIPIENTS")
        raw_recipients: list[str] = []
        if recipients.strip():
            raw_recipients.append(recipients)
        elif env_recipients:
            raw_recipients.append(env_recipients)

        final_recipients = parse_recipients(raw_recipients)
        if not final_recipients:
            raise HTTPException(
                status_code=400,
                detail="No recipients provided. Set recipients in request or REPORT_RECIPIENTS in .env.",
            )

        smtp_args = build_smtp_args(final_recipients, email_subject_prefix)
        if not smtp_args.smtp_username or not smtp_args.smtp_password:
            raise HTTPException(
                status_code=400,
                detail="SMTP not configured. Set SMTP_USERNAME and SMTP_PASSWORD in .env.",
            )

        screenshot_bytes = await screenshot.read() if screenshot else None
        if screenshot_bytes:
            smtp_args.screenshot_bytes = screenshot_bytes
            smtp_args.screenshot_filename = (screenshot.filename or "xenon-structure.png")

        send_report_email(report, smtp_args)
        return {
            "ok": True,
            "email_sent_to": final_recipients,
            "screenshot_attached": bool(screenshot_bytes),
            "report_text": report_to_text(report),
        }
    except HTTPException:
        raise
    except json.JSONDecodeError as decode_error:
        raise HTTPException(status_code=400, detail=f"Invalid report_json: {decode_error}") from decode_error
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/extract-json")
async def extract_json(
    file: UploadFile = File(...),
    max_entities: int = Form(1500),
) -> dict:
    if file is None:
        raise HTTPException(status_code=400, detail="Please upload a file.")

    temp_path: Path | None = None
    try:
        payload = await file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        upload_name = (file.filename or "upload.ifc").strip() or "upload.ifc"
        suffix = Path(upload_name).suffix or ".ifc"
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(payload)
            temp_path = Path(temp_file.name)

        if max_entities <= 0:
            max_entities = 1

        try:
            extracted = extract_ifc_json(temp_path, max_entities=max_entities)
            extracted["source_filename"] = upload_name
            return {"ok": True, "data": extracted}
        except Exception as parse_exc:
            raise HTTPException(
                status_code=400,
                detail=f"Uploaded file could not be parsed as IFC: {parse_exc}",
            ) from parse_exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


@app.post("/try-fix-ai")
async def try_fix_ai(
    file: UploadFile = File(...),
    recipients: str = Form(""),
    email_subject_prefix: str = Form("Xenon AI IFC Fix"),
) -> dict:
    if file is None:
        raise HTTPException(status_code=400, detail="Please upload a file.")

    temp_path: Path | None = None
    try:
        payload = await file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        upload_name = (file.filename or "upload.ifc").strip() or "upload.ifc"
        suffix = Path(upload_name).suffix or ".ifc"
        with NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(payload)
            temp_path = Path(temp_file.name)

        try:
            original_report = evaluate_ventilation(temp_path)
        except Exception as parse_exc:
            raise HTTPException(
                status_code=400,
                detail=f"Uploaded file could not be parsed as IFC: {parse_exc}",
            ) from parse_exc

        fix_result = await create_ai_fixed_ifc(temp_path, original_report)
        fixed_path: Path = fix_result["output_path"]
        fixed_report = evaluate_ventilation(fixed_path)

        fixed_bytes = fixed_path.read_bytes()

        env_recipients = read_env_direct("REPORT_RECIPIENTS")
        raw_recipients: list[str] = []
        if recipients.strip():
            raw_recipients.append(recipients)
        elif env_recipients:
            raw_recipients.append(env_recipients)
        final_recipients = parse_recipients(raw_recipients)

        email_sent = False
        email_error = None
        if final_recipients:
            smtp_args = build_smtp_args(final_recipients, email_subject_prefix)
            smtp_args.ifc_bytes = fixed_bytes
            smtp_args.ifc_filename = fix_result["output_name"]
            try:
                send_report_email(fixed_report, smtp_args)
                email_sent = True
            except Exception as mail_exc:
                email_error = f"SMTP send failed: {type(mail_exc).__name__}: {mail_exc}"
        else:
            email_error = "No recipients provided. Add emails in UI or set REPORT_RECIPIENTS in .env."

        return {
            "ok": True,
            "email_sent_to": final_recipients if email_sent else [],
            "email_error": email_error,
            "fixed_ifc_filename": fix_result["output_name"],
            "fixed_ifc_saved_path": str(fixed_path),
            "fixed_ifc_base64": base64.b64encode(fixed_bytes).decode("ascii"),
            "report_text": report_to_text(fixed_report),
            "fix_meta": {
                "changed_window_ids": fix_result["changed_window_ids"],
                "changed_windows_count": len(fix_result["changed_window_ids"]),
                "window_area_scale": round(float(fix_result["window_area_scale"]), 6),
                "window_dimension_scale": round(float(fix_result["window_dimension_scale"]), 6),
                "target_percent": round(float(fix_result["target_percent"]), 3),
                "groq_used": bool(fix_result["groq_used"]),
                "groq_error": fix_result["groq_error"],
            },
            "original_report": {
                "schema": original_report.schema,
                "rooms_found": original_report.rooms_found,
                "windows_found": original_report.windows_found,
                "total_room_area": round(original_report.total_room_area, 3),
                "total_window_area": round(original_report.total_window_area, 3),
                "ventilation_percent": round(original_report.ventilation_percent, 2),
                "spaces_missing_area": original_report.spaces_missing_area,
                "windows_missing_area": original_report.windows_missing_area,
                "status": original_report.status,
                "result": original_report.result,
                "threshold_percent": original_report.threshold_percent,
                "source_filename": upload_name,
                "window_ids": original_report.window_ids,
            },
            "fixed_report": {
                "schema": fixed_report.schema,
                "rooms_found": fixed_report.rooms_found,
                "windows_found": fixed_report.windows_found,
                "total_room_area": round(fixed_report.total_room_area, 3),
                "total_window_area": round(fixed_report.total_window_area, 3),
                "ventilation_percent": round(fixed_report.ventilation_percent, 2),
                "spaces_missing_area": fixed_report.spaces_missing_area,
                "windows_missing_area": fixed_report.windows_missing_area,
                "status": fixed_report.status,
                "result": fixed_report.result,
                "threshold_percent": fixed_report.threshold_percent,
                "source_filename": fix_result["output_name"],
                "window_ids": fixed_report.window_ids,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)
