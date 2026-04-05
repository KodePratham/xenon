# 🏗️ Xenon Frontend — 3D IFC Preview & Compliance Highlighting

> Technical deep-dive into how `xenon-frontend` loads IFC files into a 3D viewer and visually marks non-compliant elements in red.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Technology Stack](#2-technology-stack)
3. [Phase 1 — File Upload & Ingestion](#3-phase-1--file-upload--ingestion)
4. [Phase 2 — WASM Engine Initialization](#4-phase-2--wasm-engine-initialization)
5. [Phase 3 — IFC Geometry Extraction](#5-phase-3--ifc-geometry-extraction)
6. [Phase 4 — Three.js Scene Setup & Rendering](#6-phase-4--threejs-scene-setup--rendering)
7. [Phase 5 — Camera Fitting](#7-phase-5--camera-fitting)
8. [Phase 6 — Compliance Report & Red Marking](#8-phase-6--compliance-report--red-marking)
9. [Complete Data Flow Diagram](#9-complete-data-flow-diagram)
10. [Key File Reference](#10-key-file-reference)

---

## 1. Architecture Overview

The system follows a **two-stage pipeline**:

| Stage | What Happens | Where |
|---|---|---|
| **Stage 1: 3D Preview** | IFC file → parsed client-side via WASM → rendered in Three.js | Frontend (`app.js`) |
| **Stage 2: Compliance** | IFC file → sent to backend → ventilation analysis → failing window IDs returned → frontend colors them red | Backend (`api.py` + `check_ventilation_rule.py`) → Frontend (`app.js`) |

> **Important:** The 3D preview is entirely **client-side** (no backend needed). The red marking only happens **after** the backend returns a compliance report with `window_ids`.

---

## 2. Technology Stack

| Component | Library / Tool | Purpose |
|---|---|---|
| 3D Rendering | [Three.js](https://threejs.org/) `^0.160.0` | WebGL scene, camera, lights, mesh rendering |
| IFC Parsing | [web-ifc](https://github.com/IFCjs/web-ifc) `^0.0.77` | WASM-based IFC geometry extraction in the browser |
| Camera Controls | `OrbitControls` (Three.js addon) | Mouse-based rotate/pan/zoom |
| Build Tool | [Vite](https://vitejs.dev/) `^8.0.3` | ES module dev server, serves WASM files from `/public/` |
| Backend | FastAPI + ifcopenshell (Python) | Parses IFC for ventilation rule compliance |

---

## 3. Phase 1 — File Upload & Ingestion

**Relevant code:** `app.js` lines 228–254

The user can provide an IFC file via two methods:

### a) Drag & Drop

```
dropZone → "dragover" / "drop" events → handleFile()
```

### b) File Input Click

```
fileInput → "change" event → handleFile()
```

### `handleFile(file)` — The Entry Point

```javascript
async function handleFile(file) {
  // 1. Validate extension (.ifc only)
  if (!file.name.toLowerCase().endsWith(".ifc")) { ... return; }

  // 2. Store reference for later backend submission
  selectedFile = file;

  // 3. Trigger 3D preview loading
  const count = await loadIfcFile(file);

  // 4. Update UI with geometry count
  setStatus(`Loaded ${file.name} (${count} geometries)`, "success");
}
```

> **Note:** The file is kept in memory (as a `File` object) so it can be re-sent to the backend later via `FormData` when the user clicks "Generate Report".

---

## 4. Phase 2 — WASM Engine Initialization

**Relevant code:** `app.js` lines 111–126

```javascript
const ifcApi = new WebIFC.IfcAPI();
ifcApi.SetWasmPath("/");          // WASM files served from /public/ by Vite
await ifcApi.Init();              // Loads & compiles web-ifc.wasm
```

### How WASM files are served

```
xenon-frontend/
├── public/
│   ├── web-ifc.wasm          ← 1.30 MB, the core WASM binary
│   └── web-ifc-mt.wasm       ← 1.31 MB, multi-threaded variant
```

Vite automatically serves files in `/public/` at the root URL `/`, so `SetWasmPath("/")` tells `web-ifc` to fetch the `.wasm` files from `http://localhost:5500/web-ifc.wasm`.

### IFC File Parsing

```javascript
const buffer = await file.arrayBuffer();
const data = new Uint8Array(buffer);
const modelID = ifcApi.OpenModel(data);   // Parse the binary IFC into web-ifc's internal model
```

This happens entirely in the browser — no server roundtrip needed.

---

## 5. Phase 3 — IFC Geometry Extraction

**Relevant code:** `app.js` lines 128–203

This is the core of the 3D preview. The method `StreamAllMeshes` iterates over every renderable element in the IFC model:

```javascript
ifcApi.StreamAllMeshes(modelID, (mesh) => {
    // mesh.expressID = unique IFC element identifier
    // mesh.geometries = array of sub-geometries with transforms
    for (let i = 0; i < mesh.geometries.size(); i++) {
        const placedGeom = mesh.geometries.get(i);
        // ... extract vertices, normals, indices, transform, color
    }
});
```

### Step-by-step per geometry:

#### Step 1: Extract raw vertex data

```javascript
const geom = ifcApi.GetGeometry(modelID, placedGeom.geometryExpressID);
const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
```

#### Step 2: De-interleave vertices

The raw vertex array is interleaved as `[x, y, z, nx, ny, nz]` per vertex (6 floats each). The code separates positions and normals:

```javascript
const vertCount = verts.length / 6;
for (let v = 0; v < vertCount; v++) {
    positions[v*3+0] = verts[v*6+0];  // x
    positions[v*3+1] = verts[v*6+1];  // y
    positions[v*3+2] = verts[v*6+2];  // z
    normals[v*3+0]   = verts[v*6+3];  // nx
    normals[v*3+1]   = verts[v*6+4];  // ny
    normals[v*3+2]   = verts[v*6+5];  // nz
}
```

#### Step 3: Apply transform matrix

Each sub-geometry has a 4×4 flat transformation matrix for its placement in world space:

```javascript
const fm = placedGeom.flatTransformation;
const matrix = new THREE.Matrix4();
matrix.set(
    fm[0], fm[4], fm[8],  fm[12],   // Column-major → Row-major
    fm[1], fm[5], fm[9],  fm[13],
    fm[2], fm[6], fm[10], fm[14],
    fm[3], fm[7], fm[11], fm[15]
);
bufferGeom.applyMatrix4(matrix);
```

#### Step 4: Extract color from IFC

```javascript
const color = new THREE.Color(placedGeom.color.x, placedGeom.color.y, placedGeom.color.z);
const opacity = placedGeom.color.w;

// Brighten near-black elements for visibility
const lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
if (lum < 0.15) color.set(0x889999);
```

#### Step 5: Create Three.js mesh and add to scene

```javascript
const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.5,
    metalness: 0.2,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
});

const meshObj = new THREE.Mesh(bufferGeom, mat);
meshObj.userData.isIfc = true;
meshObj.userData.expressID = mesh.expressID;           // ← KEY: links mesh to IFC element
meshObj.userData.originalColor = color.clone();         // ← saved for reset after compliance check
scene.add(meshObj);
```

> **Important:** Every mesh stores its `expressID` in `userData`. This is the **critical link** that allows the red marking to work later — the backend returns a list of failing `window_ids` (which are IFC Express IDs), and the frontend matches them against `mesh.userData.expressID`.

---

## 6. Phase 4 — Three.js Scene Setup & Rendering

**Relevant code:** `app.js` lines 36–94

The scene is initialized once (lazily, on first file load):

```
initThreeScene()
  ├── Scene + White Background
  ├── PerspectiveCamera (FOV = 50)
  ├── WebGLRenderer (ACES Filmic Tone Mapping)
  ├── OrbitControls (with damping)
  ├── Lighting Setup
  ├── Grid + Axes Helpers
  └── Animation Loop (requestAnimationFrame)
```

### Lighting Setup

| Light | Type | Color | Intensity | Position |
|---|---|---|---|---|
| Ambient | `AmbientLight` | White | 0.6 | N/A |
| Key Light | `DirectionalLight` | White | 1.2 | (20, 30, 20) |
| Fill Light | `DirectionalLight` | Blue-white `#d8e8ff` | 0.5 | (−10, 20, −10) |

### Render Loop

```javascript
(function animate() {
    requestAnimationFrame(animate);
    controls.update();          // Smooth damping
    renderer.render(scene, camera);
})();
```

---

## 7. Phase 5 — Camera Fitting

**Relevant code:** `app.js` lines 207–223

After all meshes are loaded, the camera automatically frames the model:

```javascript
// Compute bounding box of all IFC geometries
const center = new THREE.Vector3();
const size = new THREE.Vector3();
box.getCenter(center);
box.getSize(size);
const maxDim = Math.max(size.x, size.y, size.z, 0.1);
const dist = maxDim * 2.5;

// Position camera at 0.8x, 0.6x, 0.8x of the computed distance
camera.position.set(
    center.x + dist * 0.8,
    center.y + dist * 0.6,
    center.z + dist * 0.8
);
camera.lookAt(center);
controls.target.copy(center);
```

This ensures the model is always visible regardless of its real-world scale.

---

## 8. Phase 6 — Compliance Report & Red Marking

This is the most critical section — how non-compliant parts get marked **red**.

### 8.1 Backend Compliance Analysis

When the user clicks **"Generate Report & Send Mail"**, the frontend sends the IFC file to the backend:

**Relevant code:** `app.js` lines 317–346

```javascript
const fd = new FormData();
fd.append("file", selectedFile);
const r = await fetch(apiBase + "/analyze", { method: "POST", body: fd });
const d = await r.json();
```

### 8.2 What the Backend Does

**Relevant code:** `../xenon-backend/check_ventilation_rule.py` lines 127–248

The backend uses **ifcopenshell** (Python) to:

1. **Find all rooms** → `model.by_type("IfcSpace")`
2. **Find all windows** → `model.by_type("IfcWindow")`
3. **Compute room floor areas** → from `IfcElementQuantity` (`NetFloorArea`, `GrossFloorArea`)
4. **Compute window opening areas** → from `IfcElementQuantity` or `OverallHeight × OverallWidth`
5. **Calculate ventilation ratio** → `(total_window_area / total_room_area) × 100`
6. **Apply the 10% rule** → if ratio ≥ 10% → `PASS`, else → `FAIL`

### 8.3 The `window_ids` Field — The Bridge

> **This is the key mechanism that connects backend analysis to frontend visualization.**

The backend **always returns all window Express IDs** in the `window_ids` field:

```python
window_ids=[w.id() for w in windows]     # IFC Express IDs of ALL windows
```

These are the **IFC Express IDs** — the same identifiers stored in `mesh.userData.expressID` on the frontend.

The API response includes:

```json
{
    "report": {
        "result": "FAIL",
        "window_ids": [1234, 5678, 9012],
        "ventilation_percent": 7.5
    }
}
```

### 8.4 The Red Marking Logic (Frontend)

**Relevant code:** `app.js` lines 275–300 — `applyReportColors()`

```javascript
function applyReportColors(report) {
    scene.traverse(obj => {
        if (obj.isMesh && obj.userData.isIfc) {

            // Check: is this mesh a FAILING window?
            const isFailingWindow = report.result === "FAIL"
                && report.window_ids?.includes(obj.userData.expressID);

            if (isFailingWindow) {
                // ── MARK RED ──
                obj.material.color.set(0xff0000);     // Bright red
                obj.material.opacity = 0.5;            // 50% transparent
                obj.material.depthTest = false;        // Render OVER walls
                obj.material.needsUpdate = true;
                obj.scale.set(1.05, 1.05, 1.05);      // Slightly larger
                obj.renderOrder = 999;                  // Draw on top

            } else {
                // ── RESET TO ORIGINAL ──
                obj.material.color.copy(obj.userData.originalColor);
                obj.material.opacity = 0.95;
                obj.material.depthTest = true;
                obj.material.needsUpdate = true;
                obj.scale.set(1, 1, 1);
                obj.renderOrder = 0;
            }
        }
    });
}
```

### 8.5 Visual Effects Applied to Failing Windows

| Property | Normal Value | Failing Value | Why |
|---|---|---|---|
| `color` | Original IFC color | `0xff0000` (bright red) | Instantly visible as non-compliant |
| `opacity` | `0.95` (near-opaque) | `0.5` (semi-transparent) | Shows structure behind the window |
| `depthTest` | `true` | `false` | Window renders **over** walls, never hidden |
| `scale` | `(1, 1, 1)` | `(1.05, 1.05, 1.05)` | Slightly protrudes from the wall |
| `renderOrder` | `0` | `999` | Drawn last, always on top |

> **Tip:** The combination of `depthTest: false`, `renderOrder: 999`, and `scale: 1.05` creates a striking visual effect where non-compliant windows "glow" red and pop out of the building model, making them impossible to miss.

### 8.6 When Does Red Marking Trigger?

Red marking **only** activates when **both** conditions are true:

1. `report.result === "FAIL"` — the overall ventilation check failed
2. `report.window_ids.includes(obj.userData.expressID)` — this specific mesh is a window

If the report result is `"PASS"`, **no elements are marked red** — all meshes keep their original colors.

---

## 9. Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                  PHASE 1: 3D PREVIEW (Client-Side Only)            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User drops .ifc file                                               │
│       │                                                             │
│       ▼                                                             │
│  handleFile(file)                                                   │
│       │                                                             │
│       ▼                                                             │
│  loadIfcFile(file)                                                  │
│       │                                                             │
│       ├──► new WebIFC.IfcAPI()                                      │
│       │        │                                                    │
│       │        ├──► SetWasmPath("/")                                │
│       │        ├──► Init()  ← loads web-ifc.wasm from /public/      │
│       │        └──► OpenModel(Uint8Array)  ← parses IFC binary      │
│       │                                                             │
│       ├──► StreamAllMeshes(modelID, callback)                       │
│       │        │                                                    │
│       │        └──► For each mesh:                                  │
│       │              ├── GetGeometry() → vertices + indices          │
│       │              ├── De-interleave [x,y,z,nx,ny,nz]             │
│       │              ├── Apply 4×4 transform matrix                  │
│       │              ├── Extract IFC color                           │
│       │              ├── Create THREE.Mesh with MeshStandardMaterial │
│       │              ├── Store expressID in userData  ◄── KEY        │
│       │              └── scene.add(mesh)                             │
│       │                                                             │
│       └──► Fit camera to bounding box                               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│             PHASE 2: COMPLIANCE CHECK (Client + Server)            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User clicks "Generate Report"                                      │
│       │                                                             │
│       ▼                                                             │
│  POST /analyze (FormData with .ifc file)                            │
│       │                                                             │
│       ▼  (Backend)                                                  │
│  ifcopenshell.open(ifc_file)                                        │
│       │                                                             │
│       ├──► model.by_type("IfcSpace")  → rooms[]                     │
│       ├──► model.by_type("IfcWindow") → windows[]                   │
│       ├──► Compute room floor areas (IfcElementQuantity)             │
│       ├──► Compute window opening areas (quantity or H×W)            │
│       ├──► ventilation_percent = (window_area / room_area) × 100     │
│       ├──► result = "PASS" if ≥ 10%, else "FAIL"                    │
│       └──► window_ids = [w.id() for w in windows]  ◄── KEY          │
│                                                                     │
│       ▼  (Response JSON)                                            │
│  { result: "FAIL", window_ids: [1234, 5678], ... }                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    PHASE 3: RED MARKING (Client-Side)               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  applyReportColors(report)                                          │
│       │                                                             │
│       ▼                                                             │
│  scene.traverse(obj => {                                            │
│       │                                                             │
│       ├── if (expressID in window_ids AND result == "FAIL")          │
│       │       ├── color = RED (0xff0000)                             │
│       │       ├── opacity = 0.5                                      │
│       │       ├── depthTest = false  (render over walls)             │
│       │       ├── scale = 1.05  (pop out)                            │
│       │       └── renderOrder = 999  (draw on top)                   │
│       │                                                             │
│       └── else                                                      │
│               └── Reset to original color & defaults                 │
│  })                                                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10. Key File Reference

| File | Role | Key Lines |
|---|---|---|
| `app.js` | All frontend logic | Entire file (377 lines) |
| `app.js` L36–94 | Three.js scene setup | `initThreeScene()` |
| `app.js` L111–226 | IFC loading & geometry extraction | `loadIfcFile()` |
| `app.js` L275–300 | **Red marking logic** | `applyReportColors()` |
| `app.js` L317–346 | Backend API call | `runReportBtn` click handler |
| `index.html` | Page structure | Drop zone, viewer container, report section |
| `styles.css` | All visual styling | 336 lines |
| `vite.config.js` | Dev server config | Port 5500, auto-open |
| `public/web-ifc.wasm` | WASM binary | Loaded by web-ifc at runtime |
| `../xenon-backend/api.py` | FastAPI endpoint | `POST /analyze` |
| `../xenon-backend/check_ventilation_rule.py` | Ventilation compliance logic | `evaluate_ventilation()` |

---

> **Summary:** The 3D preview is fully client-side using `web-ifc` WASM + Three.js. The red marking is a post-analysis overlay — the backend identifies non-compliant windows by their IFC Express IDs, and the frontend matches them against the already-rendered 3D meshes, changing their material to red with enhanced visibility effects (no depth test, increased scale, top render order).
