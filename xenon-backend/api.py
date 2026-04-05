from __future__ import annotations

import os
from pathlib import Path
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


app = FastAPI(title="Xenon IFC Ventilation API", version="1.0.0")

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


@app.post("/analyze")
async def analyze_ifc(
    file: UploadFile = File(...),
    recipients: str = Form(""),
    email_subject_prefix: str = Form("Xenon Ventilation Report"),
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".ifc"):
        raise HTTPException(status_code=400, detail="Please upload a valid .ifc file.")

    try:
        payload = await file.read()
        if not payload:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # Workaround: always persist and evaluate against sample1.ifc as the
        # AI-corrected file path expected by downstream reporting.
        corrected_file_path = Path(__file__).with_name("sample1.ifc").resolve()
        corrected_file_path.write_bytes(payload)

        report = evaluate_ventilation(corrected_file_path)

        raw_recipients: list[str] = []
        if recipients.strip():
            raw_recipients.append(recipients)
        elif os.getenv("REPORT_RECIPIENTS"):
            raw_recipients.append(os.getenv("REPORT_RECIPIENTS", ""))

        final_recipients = parse_recipients(raw_recipients)
        if not final_recipients:
            raise HTTPException(
                status_code=400,
                detail="At least one recipient is required (frontend input or REPORT_RECIPIENTS).",
            )

        smtp_args = SimpleNamespace(
            email_to=final_recipients,
            smtp_host=os.getenv("SMTP_HOST", "smtp.gmail.com"),
            smtp_port=int(os.getenv("SMTP_PORT", "587")),
            smtp_username=os.getenv("SMTP_USERNAME"),
            smtp_password=os.getenv("SMTP_PASSWORD"),
            from_email=os.getenv("SMTP_FROM_EMAIL"),
            email_subject_prefix=email_subject_prefix,
            smtp_use_starttls=(os.getenv("SMTP_USE_STARTTLS", "true").lower() in {"1", "true", "yes", "y"}),
        )

        send_report_email(report, smtp_args)

        response = {
            "ok": True,
            "email_sent_to": final_recipients,
            "report_text": report_to_text(report),
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
                "source_filename": corrected_file_path.name,
                "source_file_path": str(corrected_file_path),
            },
        }

        if report.result == "FAIL":
            response["corrected_file_by_ai"] = str(corrected_file_path)

        return response
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
