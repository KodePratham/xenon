/* ────────────────────────────────────────────────────────
   Xenon Ventilation Studio — IFC Viewer
   Uses web-ifc + Three.js via ES modules (Vite)
   Same approach as the working StructAI viewer
   ──────────────────────────────────────────────────────── */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as WebIFC from 'web-ifc';

/* ─── DOM refs ─── */
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("ifc-input");
const selectedFileEl = document.getElementById("selected-file");
const runReportBtn = document.getElementById("run-report");
const statusEl = document.getElementById("status");
const reportContainer = document.getElementById("report");
const reportGrid = document.getElementById("report-grid");
const suggestionsEl = document.getElementById("suggestions");
const reportText = document.getElementById("report-text");
const viewerContainer = document.getElementById("viewer-container");
const apiUrlInput = document.getElementById("api-url");
const emailsInput = document.getElementById("emails");
const subjectPrefixInput = document.getElementById("subject-prefix");

let selectedFile = null;
let scene, camera, renderer, controls;
let viewerInitialized = false;

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status " + (kind || "idle");
}

/* ─── Three.js Scene Setup ─── */
function initThreeScene() {
  if (viewerInitialized) return;

  const w = viewerContainer.clientWidth || 800;
  const h = viewerContainer.clientHeight || 500;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 10000);
  camera.position.set(15, 12, 15);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  viewerContainer.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Lighting (same as Xenon)
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(20, 30, 20);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd8e8ff, 0.5);
  fill.position.set(-10, 20, -10);
  scene.add(fill);

  // Infinite grid with 50% transparency
  const grid = new THREE.GridHelper(10000, 10000, 0x888888, 0x888888);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);

  // Axes
  scene.add(new THREE.AxesHelper(5));

  // Resize
  window.addEventListener("resize", () => {
    const w2 = viewerContainer.clientWidth;
    const h2 = viewerContainer.clientHeight;
    camera.aspect = w2 / h2;
    camera.updateProjectionMatrix();
    renderer.setSize(w2, h2);
  });

  // Animate
  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();

  viewerInitialized = true;
}

/* ─── Clear old model ─── */
function clearModel() {
  if (!scene) return;
  const toRemove = [];
  scene.traverse(obj => {
    if (obj.isMesh && obj.userData.isIfc) toRemove.push(obj);
  });
  toRemove.forEach(obj => {
    obj.geometry.dispose();
    if (obj.material.dispose) obj.material.dispose();
    scene.remove(obj);
  });
}

/* ─── Load IFC using web-ifc directly (same as Xenon) ─── */
async function loadIfcFile(file) {
  initThreeScene();
  clearModel();

  setStatus("Initializing WASM engine...", "running");

  // Init web-ifc — WASM in /public/ served at root by Vite (same as Xenon)
  const ifcApi = new WebIFC.IfcAPI();
  ifcApi.SetWasmPath("/");
  await ifcApi.Init();

  setStatus("Parsing IFC geometry...", "running");

  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const modelID = ifcApi.OpenModel(data);

  // Extract meshes (identical to Xenon Viewer.jsx)
  let meshCount = 0;
  const box = new THREE.Box3();

  ifcApi.StreamAllMeshes(modelID, (mesh) => {
    for (let i = 0; i < mesh.geometries.size(); i++) {
      const placedGeom = mesh.geometries.get(i);
      const geom = ifcApi.GetGeometry(modelID, placedGeom.geometryExpressID);

      const verts = ifcApi.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const indices = ifcApi.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());

      if (verts.length === 0 || indices.length === 0) {
        geom.delete();
        continue;
      }

      // Interleaved: [x, y, z, nx, ny, nz] per vertex
      const vertCount = verts.length / 6;
      const positions = new Float32Array(vertCount * 3);
      const normals = new Float32Array(vertCount * 3);
      for (let v = 0; v < vertCount; v++) {
        positions[v * 3 + 0] = verts[v * 6 + 0];
        positions[v * 3 + 1] = verts[v * 6 + 1];
        positions[v * 3 + 2] = verts[v * 6 + 2];
        normals[v * 3 + 0] = verts[v * 6 + 3];
        normals[v * 3 + 1] = verts[v * 6 + 4];
        normals[v * 3 + 2] = verts[v * 6 + 5];
      }

      // Transform matrix
      const fm = placedGeom.flatTransformation;
      const matrix = new THREE.Matrix4();
      matrix.set(
        fm[0], fm[4], fm[8],  fm[12],
        fm[1], fm[5], fm[9],  fm[13],
        fm[2], fm[6], fm[10], fm[14],
        fm[3], fm[7], fm[11], fm[15]
      );

      const bufferGeom = new THREE.BufferGeometry();
      bufferGeom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      bufferGeom.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      bufferGeom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      bufferGeom.applyMatrix4(matrix);

      // Color from IFC
      const color = new THREE.Color(placedGeom.color.x, placedGeom.color.y, placedGeom.color.z);
      const opacity = placedGeom.color.w;

      // Brighten near-black
      const lum = color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
      if (lum < 0.15) color.set(0x889999);

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
      meshObj.userData.expressID = mesh.expressID;
      meshObj.userData.originalColor = color.clone();
      scene.add(meshObj);

      bufferGeom.computeBoundingBox();
      if (bufferGeom.boundingBox) box.union(bufferGeom.boundingBox);

      meshCount++;
      geom.delete();
    }
  });

  ifcApi.CloseModel(modelID);

  // Fit camera
  if (meshCount > 0 && !box.isEmpty()) {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    const dist = maxDim * 2.5;

    camera.near = maxDim * 0.001;
    camera.far = maxDim * 100;
    camera.position.set(center.x + dist * 0.8, center.y + dist * 0.6, center.z + dist * 0.8);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  return meshCount;
}

/* ─── File handler ─── */
async function handleFile(file) {
  if (!file) return;
  selectedFile = file;
  selectedFileEl.textContent = "Selected: " + file.name;
  setStatus("Loading 3D preview...", "running");
  try {
    const count = await loadIfcFile(file);
    setStatus(`Loaded ${file.name} (${count} geometries)`, "success");
  } catch (err) {
    console.error(err);
    setStatus("Failed to load: " + (err.message || err), "error");
  }
}

/* ─── Drag & drop ─── */
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", () => { dropZone.classList.remove("drag-over"); });
dropZone.addEventListener("drop", e => {
  e.preventDefault(); dropZone.classList.remove("drag-over");
  handleFile(e.dataTransfer?.files[0]);
});
fileInput.addEventListener("change", e => { handleFile(e.target.files?.[0]); });

/* ─── Suggestions ─── */
const typeEmoji = { success: '✅', critical: '🚨', warning: '⚠️', action: '🔧', info: 'ℹ️' };

function renderSuggestions(items) {
  suggestionsEl.innerHTML = '';
  if (!items.length) return;
  const title = document.createElement('h3');
  title.textContent = '💡 AI Suggestions';
  title.style.cssText = 'margin:16px 0 8px;font-size:1.05rem;';
  suggestionsEl.appendChild(title);
  items.forEach(s => {
    const card = document.createElement('div');
    card.className = 'suggestion-card suggestion-' + s.type;
    card.innerHTML = `<strong>${typeEmoji[s.type] || '•'} ${s.title}</strong><p>${s.detail.replace(/\n/g, '<br>')}</p>`;
    suggestionsEl.appendChild(card);
  });
}

/* ─── Report ─── */
function applyReportColors(report) {
  if (!scene) return;
  scene.traverse(obj => {
    if (obj.isMesh && obj.userData.isIfc) {
      const isFailingWindow = report.result === "FAIL" && report.window_ids?.includes(obj.userData.expressID);
      
      if (isFailingWindow) {
        obj.material.color.set(0xff0000); // Bright red
        obj.material.opacity = 0.5;       // 50% transparent
        obj.material.depthTest = false;   // Render over walls
        obj.material.needsUpdate = true;
        obj.scale.set(1.05, 1.05, 1.05);  // Make it protrude slightly
        obj.renderOrder = 999;
      } else {
        if (obj.userData.originalColor) {
          obj.material.color.copy(obj.userData.originalColor);
        }
        obj.material.opacity = 0.95;      // Default 95% opacity
        obj.material.depthTest = true;
        obj.material.needsUpdate = true;
        obj.scale.set(1, 1, 1);
        obj.renderOrder = 0;
      }
    }
  });
}

function renderReport(report) {
  const metrics = [
    ["Result", report.result], ["Schema", report.schema],
    ["Rooms", report.rooms_found], ["Windows", report.windows_found],
    ["Room Area", report.total_room_area + " m²"], ["Window Area", report.total_window_area + " m²"],
    ["Ventilation", report.ventilation_percent + "%"], ["Status", report.status],
  ];
  reportGrid.innerHTML = "";
  metrics.forEach(([label, value]) => {
    const c = document.createElement("div"); c.className = "metric";
    c.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    reportGrid.appendChild(c);
  });
}

runReportBtn.addEventListener("click", async () => {
  if (!selectedFile) { setStatus("Upload an IFC file first.", "error"); return; }
  const apiBase = apiUrlInput.value.trim().replace(/\/$/, "");
  if (!apiBase) { setStatus("Provide the backend API URL.", "error"); return; }
  setStatus("Generating report...", "running");
  const fd = new FormData();
  fd.append("file", selectedFile);
  fd.append("recipients", emailsInput.value.trim());
  fd.append("email_subject_prefix", subjectPrefixInput.value.trim());
  try {
    const r = await fetch(apiBase + "/analyze", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "Server error");
    renderReport(d.report);
    applyReportColors(d.report);
    renderSuggestions(d.suggestions || []);
    reportText.textContent = d.report_text;
    reportContainer.classList.remove("hidden");
    if (d.email_sent_to && d.email_sent_to.length > 0) {
      setStatus("Report ready — emailed to: " + d.email_sent_to.join(", "), "success");
    } else if (d.email_error) {
      setStatus("⚠ Report ready but email failed: " + d.email_error, "running");
    } else {
      setStatus("Report ready!", "success");
    }
  } catch (err) {
    console.error(err);
    setStatus("Request failed: " + err.message, "error");
  }
});

/* ─── Fullscreen toggle (browser Fullscreen API) ─── */
const fullscreenBtn = document.getElementById("fullscreen-btn");

function resizeViewer() {
  if (!renderer) return;
  setTimeout(() => {
    const w = viewerContainer.clientWidth;
    const h = viewerContainer.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }, 100);
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await viewerContainer.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
}

fullscreenBtn.addEventListener("click", toggleFullscreen);

document.addEventListener("fullscreenchange", () => {
  const isFs = !!document.fullscreenElement;
  fullscreenBtn.textContent = isFs ? "✕" : "⛶";
  resizeViewer();
});
