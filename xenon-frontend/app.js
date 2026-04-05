const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("ifc-input");
const selectedFileEl = document.getElementById("selected-file");
const runReportBtn = document.getElementById("run-report");
const statusEl = document.getElementById("status");
const reportContainer = document.getElementById("report");
const reportGrid = document.getElementById("report-grid");
const reportText = document.getElementById("report-text");
const viewerContainer = document.getElementById("viewer-container");
const apiUrlInput = document.getElementById("api-url");
const emailsInput = document.getElementById("emails");
const subjectPrefixInput = document.getElementById("subject-prefix");

let selectedFile = null;
let viewer = null;
let currentModelId = null;
let viewerLibraryLoadPromise = null;

function getErrorMessage(error) {
  if (!error) {
    return "Unknown IFC loader error.";
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.message) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getModelIdFromResult(model) {
  if (!model || typeof model !== "object") {
    return null;
  }

  if (typeof model.modelID === "number") {
    return model.modelID;
  }

  if (typeof model.modelId === "number") {
    return model.modelId;
  }

  if (typeof model.id === "number") {
    return model.id;
  }

  return null;
}

function getFallbackModelIdFromManager() {
  const models = viewer?.IFC?.loader?.ifcManager?.state?.models;
  if (!models || typeof models !== "object") {
    return null;
  }

  const modelIds = Object.keys(models)
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id));

  if (!modelIds.length) {
    return null;
  }

  return Math.max(...modelIds);
}

function getFallbackModelIdFromContext() {
  const ifcModels = viewer?.context?.items?.ifcModels;
  if (!Array.isArray(ifcModels) || !ifcModels.length) {
    return null;
  }

  const lastModel = ifcModels[ifcModels.length - 1];
  return getModelIdFromResult(lastModel);
}

function getViewerCtor() {
  if (window.IFCViewerAPI) {
    return window.IFCViewerAPI;
  }

  if (window.WebIFCViewer && window.WebIFCViewer.IFCViewerAPI) {
    return window.WebIFCViewer.IFCViewerAPI;
  }

  return null;
}

function getAbsoluteWasmBasePath() {
  return new URL("./vendor/web-ifc/", window.location.href).href;
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
  });
}

async function ensureViewerLibraryLoaded() {
  if (getViewerCtor()) {
    return;
  }

  if (!viewerLibraryLoadPromise) {
    viewerLibraryLoadPromise = (async () => {
      const candidateUrls = [
        "./vendor/ifc-viewer.bundle.js",
        "https://unpkg.com/web-ifc-viewer@1.0.218/dist/IFCViewerAPI.js",
        "https://cdn.jsdelivr.net/npm/web-ifc-viewer@1.0.218/dist/IFCViewerAPI.js",
      ];

      for (const url of candidateUrls) {
        try {
          await loadScript(url);
          if (getViewerCtor()) {
            return;
          }
        } catch (error) {
          console.warn(error);
        }
      }

      throw new Error("IFC viewer library could not be loaded (local bundle and CDN failed).");
    })();
  }

  return viewerLibraryLoadPromise;
}

function setStatus(message, kind = "idle") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function renderReport(report) {
  const metrics = [
    ["Result", report.result],
    ["Schema", report.schema],
    ["Rooms", report.rooms_found],
    ["Windows", report.windows_found],
    ["Room Area", `${report.total_room_area} m^2`],
    ["Window Area", `${report.total_window_area} m^2`],
    ["Ventilation", `${report.ventilation_percent}%`],
    ["Status", report.status],
  ];

  reportGrid.innerHTML = "";
  metrics.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "metric";
    card.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    reportGrid.appendChild(card);
  });
}

async function initViewerIfNeeded() {
  if (viewer) {
    return;
  }

  await ensureViewerLibraryLoaded();
  const ViewerCtor = getViewerCtor();
  if (!ViewerCtor) {
    throw new Error("IFC viewer library not loaded.");
  }

  viewer = new ViewerCtor({
    container: viewerContainer,
  });
  viewer.axes.setAxes();
  viewer.grid.setGrid();

  const wasmBasePath = getAbsoluteWasmBasePath();
  await viewer.IFC.setWasmPath(wasmBasePath);

  // Some web-ifc builds resolve wasm relative to internal blob URLs unless absolute mode is set.
  const ifcApi = viewer?.IFC?.loader?.ifcManager?.ifcAPI;
  if (ifcApi?.SetWasmPath) {
    ifcApi.SetWasmPath(wasmBasePath, true);
  }
}

async function loadIfcPreview(file) {
  await initViewerIfNeeded();
  let loaderErrorMessage = null;

  if (currentModelId !== null) {
    try {
      const manager = viewer?.IFC?.loader?.ifcManager;
      if (manager?.close) {
        manager.close(currentModelId, true);
      }
    } catch (err) {
      console.warn("Could not close previous model:", err);
    } finally {
      currentModelId = null;
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const onViewerError = (error) => {
      loaderErrorMessage = getErrorMessage(error);
      console.error("IFC viewer loading error:", error);
    };

    let model = await viewer.IFC.loadIfcUrl(objectUrl, false, undefined, onViewerError);

    // Some viewer builds are more stable with File-based loading than URL-based loading.
    if (!model) {
      model = await viewer.IFC.loadIfc(file, false, onViewerError);
    }

    const modelId =
      getModelIdFromResult(model) ?? getFallbackModelIdFromContext() ?? getFallbackModelIdFromManager();

    if (modelId === null) {
      const rootCause = loaderErrorMessage ? ` Root cause: ${loaderErrorMessage}` : "";
      throw new Error(`Viewer loaded no IFC model. Ensure local web-ifc runtime files are served correctly.${rootCause}`);
    }

    currentModelId = modelId;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function handleFile(file) {
  if (!file) {
    return;
  }

  if (!file.name.toLowerCase().endsWith(".ifc")) {
    setStatus("Only .ifc files are supported.", "error");
    return;
  }

  selectedFile = file;
  selectedFileEl.textContent = `Selected: ${file.name}`;
  setStatus("Loading 3D preview...", "running");

  try {
    await loadIfcPreview(file);
    setStatus("IFC loaded. Ready to generate report.", "success");
  } catch (error) {
    console.error(error);
    setStatus(`Failed to load 3D preview: ${error.message}`, "error");
  }
}

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = event.dataTransfer?.files?.[0];
  handleFile(file);
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  handleFile(file);
});

runReportBtn.addEventListener("click", async () => {
  if (!selectedFile) {
    setStatus("Please upload an IFC file first.", "error");
    return;
  }

  const apiBase = apiUrlInput.value.trim().replace(/\/$/, "");
  if (!apiBase) {
    setStatus("Please provide the backend API URL.", "error");
    return;
  }

  setStatus("Generating report and sending email...", "running");

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("recipients", emailsInput.value.trim());
  formData.append("email_subject_prefix", subjectPrefixInput.value.trim());

  try {
    const response = await fetch(`${apiBase}/analyze`, {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.detail || "Failed to process IFC file.");
    }

    renderReport(data.report);
    reportText.textContent = data.report_text;
    reportContainer.classList.remove("hidden");
    setStatus(`Report ready and emailed to: ${data.email_sent_to.join(", ")}`, "success");
  } catch (error) {
    console.error(error);
    setStatus(`Request failed: ${error.message}`, "error");
  }
});
