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

function getViewerCtor() {
  if (window.IFCViewerAPI) {
    return window.IFCViewerAPI;
  }

  if (window.WebIFCViewer && window.WebIFCViewer.IFCViewerAPI) {
    return window.WebIFCViewer.IFCViewerAPI;
  }

  return null;
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
  await viewer.IFC.setWasmPath("./vendor/web-ifc/");
}

async function loadIfcPreview(file) {
  await initViewerIfNeeded();

  if (currentModelId !== null) {
    try {
      viewer.IFC.loader.ifcManager.close(currentModelId, true);
    } catch (err) {
      console.warn("Could not close previous model:", err);
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const model = await viewer.IFC.loadIfcUrl(objectUrl);
    currentModelId = model.modelID;
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
