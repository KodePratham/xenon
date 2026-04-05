from __future__ import annotations

import os
import json
import asyncio
import urllib.request
from pathlib import Path
from tempfile import NamedTemporaryFile
from types import SimpleNamespace

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from check_ventilation_rule import (
    evaluate_ventilation,
    load_env_file,
    parse_recipients,
    report_to_text,
    send_report_email,
)


_ENV_PATH = Path(__file__).with_name(".env")


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

        # Always read credentials fresh from .env on disk — never trust os.environ
        # which can be stale from server startup or uvicorn --reload.
        smtp_user = read_env_direct("SMTP_USERNAME")
        smtp_pass = read_env_direct("SMTP_PASSWORD")
        smtp_host = read_env_direct("SMTP_HOST", "smtp.gmail.com")
        smtp_port = int(read_env_direct("SMTP_PORT", "587"))
        smtp_from = read_env_direct("SMTP_FROM_EMAIL") or smtp_user
        smtp_starttls = read_env_direct("SMTP_USE_STARTTLS", "true").lower() in {"1", "true", "yes", "y"}
        env_recipients = read_env_direct("REPORT_RECIPIENTS")

        raw_recipients: list[str] = []
        if recipients.strip():
            raw_recipients.append(recipients)
        elif env_recipients:
            raw_recipients.append(env_recipients)

        final_recipients = parse_recipients(raw_recipients)

        smtp_args = SimpleNamespace(
            email_to=final_recipients,
            smtp_host=smtp_host,
            smtp_port=smtp_port,
            smtp_username=smtp_user,
            smtp_password=smtp_pass,
            from_email=smtp_from,
            email_subject_prefix=email_subject_prefix,
            smtp_use_starttls=smtp_starttls,
        )

        email_sent = False
        email_error = None
        if not final_recipients:
            email_error = "No recipients — enter email addresses in the frontend or set REPORT_RECIPIENTS in .env"
        elif not smtp_user or not smtp_pass:
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
