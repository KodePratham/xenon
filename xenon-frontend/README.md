# Xenon Frontend

Simple browser frontend for the Xenon backend ventilation checker.

## Features

- Drag and drop `.ifc` files
- 3D IFC preview in browser
- Add recipient emails from UI
- Generate report, display it on-page, and trigger backend email sending

## Run

1. Start backend API first from `xenon-backend`:

```powershell
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

2. Install frontend dependencies once (required for local IFC viewer bundle/tooling files):

```powershell
cd d:\Hackathons\xenon\xenon-frontend
npm install
```

3. Optional: build local bundle (kept for offline experiments):

```powershell
cd d:\Hackathons\xenon\xenon-frontend
npm run build:viewer
```

The app now uses a nuclear fallback viewer in `viewer-fallback.html` (iframe) that loads Three.js + web-ifc from free public CDN assets, so local `.wasm` MIME issues do not block preview.

4. Serve this folder as static files (any local static server works). Example using Python:

```powershell
cd d:\Hackathons\xenon\xenon-frontend
python -m http.server 5500
```

5. Open:

- `http://localhost:5500`

6. In the UI:

- Upload an IFC file
- Enter recipients (comma-separated)
- Click **Generate Report & Send Mail**

## Notes

- Email credentials are controlled by backend `.env` in `xenon-backend`.
- The frontend default API URL is `http://localhost:8000`.
- 3D preview uses iframe fallback with free CDN runtime (`jsdelivr`) for Three.js and web-ifc.
- Internet connection is required for iframe fallback preview mode.
- If strict offline mode is needed, switch back to local `vendor/` runtime and ensure `.wasm` is served correctly.
