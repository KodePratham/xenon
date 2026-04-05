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

3. Start the frontend with Vite (required for ES module imports like `three` and `web-ifc`):

```powershell
cd d:\Hackathons\xenon\xenon-frontend
npx vite --host 0.0.0.0 --port 5500
```

4. Open:

- `http://localhost:5500`

5. In the UI:

- Upload an IFC file
- Enter recipients (comma-separated)
- Click **Generate Report & Send Mail**

## Notes

- Email credentials are controlled by backend `.env` in `xenon-backend`.
- The frontend default API URL is `http://localhost:8000`.
- 3D viewer runtime is served from local `vendor/` assets (no CDN required during normal use).
