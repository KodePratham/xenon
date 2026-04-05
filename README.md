# Xenon IFC Ventilation Studio — Mrugesh 03-24

> **Xenon** is a full-stack BIM compliance tool that lets you upload an IFC model, render it in 3D, and generate a ventilation compliance report per the 10% natural ventilation rule.

---

## Architecture

```
xenon-one-shot-try/
├── xenon-frontend/          # Vanilla JS + Vite + Three.js + web-ifc
│   ├── index.html           # Main UI
│   ├── app.js               # ES module — IFC viewer + report UI
│   ├── styles.css            # Original design system
│   ├── vite.config.js        # Vite dev server config (port 5500)
│   ├── public/               # WASM files for web-ifc
│   │   ├── web-ifc.wasm
│   │   └── web-ifc-mt.wasm
│   └── start.bat             # One-click launcher
│
├── xenon-backend/            # FastAPI + IfcOpenShell
│   ├── api.py                # REST API — /analyze endpoint
│   ├── check_ventilation_rule.py  # Core ventilation logic
│   ├── .env.example          # SMTP config template
│   └── requirements.txt      # Python dependencies
│
├── xenon-bot/                # Telegram bot (IFC upload -> report)
│   ├── bot.py                # Telegram polling bot
│   ├── .env.example          # Bot token and backend URL template
│   └── requirements.txt      # Bot dependencies
```

---

## Quick Start

### 1. Frontend (3D Viewer)

```powershell
cd xenon-one-shot-try\xenon-frontend
npm install
npx vite
```
**Or** double-click `start.bat`.

Opens at **http://localhost:5500** — drag & drop any `.ifc` file.

### 2. Backend (Report Generator)

```powershell
cd xenon-one-shot-try\xenon-backend
pip install -r requirements.txt
python -m uvicorn api:app --reload --port 8000
```

API runs at **http://localhost:8000**.

### 3. Email Reports (Optional)

1. Copy `.env.example` → `.env` in `xenon-backend/`
2. Fill in your Gmail App Password credentials (see `GMAIL_SMTP_SETUP.md`)
3. Restart the backend

Without `.env`, reports still generate — email sending is skipped gracefully.

### 4. Telegram Bot (No 3D, report only)

The Telegram bot reuses the backend analysis endpoint so report behavior matches the app.

```powershell
cd xenon-one-shot-try\xenon-bot
python -m pip install -r requirements.txt
copy .env.example .env
python bot.py
```

Required bot env values:
- `TELEGRAM_BOT_TOKEN`
- `BACKEND_API_URL` (usually `http://127.0.0.1:8000` for local development)

Then open your bot in Telegram and upload an `.ifc` document to receive the report and AI suggestions.

---

## How It Works

### 3D Viewer (Frontend)

Uses **`web-ifc@0.0.77`** directly (same approach as Xenon) — NOT the broken `web-ifc-viewer` package.

1. `IfcAPI.Init()` + `SetWasmPath("/")` — loads WASM from `public/`
2. `IfcAPI.OpenModel(data)` — parses the raw IFC binary
3. `IfcAPI.StreamAllMeshes()` — extracts vertex/index/color data per geometry
4. **Three.js** `BufferGeometry` + `MeshStandardMaterial` renders each mesh
5. Auto-fits camera to model bounding box

### Ventilation Report (Backend)

1. `ifcopenshell.open()` — parses IFC model
2. Extracts all `IfcSpace` (rooms) → floor areas
3. Extracts all `IfcWindow` → opening areas
4. Calculates: `ventilation_ratio = window_area / room_area × 100%`
5. Rule: **PASS** if ≥ 10%, **FAIL** otherwise
6. Sends HTML email report via SMTP (if configured)

---

## What Was Fixed (Session Log)

### Problem
The IFC 3D viewer showed only grid + axes — building geometry never rendered.

### Root Cause
`web-ifc-viewer@1.0.218` internally bundles **two conflicting versions** of `web-ifc`:
- `web-ifc@0.0.46` (root dependency)
- `web-ifc@0.0.39` (nested in `web-ifc-three@0.0.125`)

**No single WASM binary can match both** → permanent `LinkError: Import #49 "a" "X"`.

### Fix
**Ditched `web-ifc-viewer` entirely.** Switched to the same approach as the working Xenon project:

| Before (Broken) | After (Working) |
|---|---|
| `web-ifc-viewer` bundle (11.8MB IIFE) | `web-ifc@0.0.77` via npm |
| esbuild-rebuilt bundle with version conflicts | Vite dev server with ES modules |
| `loadIfcUrl()` → silent WASM failure | `IfcAPI.StreamAllMeshes()` → raw geometry |
| Python `http.server` → can't serve large files | Vite → proper WASM handling |
| Local WASM with broken path resolution | WASM in `public/` served at `/` |

### Backend Fix
Made email sending **optional** — if `SMTP_USERNAME` / `SMTP_PASSWORD` aren't set in `.env`, the API still returns the full ventilation report. The frontend shows the report with a note that email was skipped.

---

## Tech Stack

| Component | Technology |
|---|---|
| 3D Viewer | Three.js r160 + web-ifc 0.0.77 |
| Frontend | Vanilla JS (ES modules) |
| Build Tool | Vite 8 |
| Backend | FastAPI + IfcOpenShell |
| IFC Parsing | web-ifc (frontend) + IfcOpenShell (backend) |
| Email | SMTP via Gmail App Password |

---

## Files Modified

- `xenon-frontend/index.html` — ES module script tag, removed broken bundle
- `xenon-frontend/app.js` — Complete rewrite using web-ifc direct API
- `xenon-frontend/styles.css` — Restored original design
- `xenon-frontend/vite.config.js` — **NEW** — Vite configuration
- `xenon-frontend/start.bat` — **NEW** — One-click launcher
- `xenon-frontend/public/web-ifc.wasm` — **NEW** — WASM binary
- `xenon-frontend/public/web-ifc-mt.wasm` — **NEW** — WASM binary (multi-threaded)
- `xenon-backend/api.py` — Made email sending optional
- `xenon-backend/.env.example` — **NEW** — SMTP config template
