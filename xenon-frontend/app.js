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
let fallbackFrame = null;
let iframeReadyPromise = null;
const iframeViewerUrl = "./viewer-fallback.html";

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

function ensureIframeViewer() {
  if (fallbackFrame) {
    return;
  }

  viewerContainer.innerHTML = "";
  fallbackFrame = document.createElement("iframe");
  fallbackFrame.src = iframeViewerUrl;
  fallbackFrame.title = "IFC Preview";
  fallbackFrame.style.width = "100%";
  fallbackFrame.style.height = "100%";
  fallbackFrame.style.border = "0";
  fallbackFrame.setAttribute("loading", "eager");
  viewerContainer.appendChild(fallbackFrame);
}

function waitForIframeReady() {
  if (iframeReadyPromise) {
    return iframeReadyPromise;
  }

  ensureIframeViewer();
  iframeReadyPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Embedded IFC viewer did not initialize in time."));
    }, 15000);

    function onMessage(event) {
      if (event.source !== fallbackFrame.contentWindow || !event.data) {
        return;
      }

      if (event.data.type === "viewer-fallback-ready") {
        clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve();
      }
    }

    window.addEventListener("message", onMessage);
  });

  return iframeReadyPromise;
}

async function loadIfcPreview(file) {
  await waitForIframeReady();
  const buffer = await file.arrayBuffer();

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Embedded viewer load timed out."));
    }, 30000);

    function cleanup() {
      clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    }

    function onMessage(event) {
      if (event.source !== fallbackFrame.contentWindow || !event.data) {
        return;
      }

      if (event.data.type === "viewer-fallback-loaded") {
        cleanup();
        resolve();
      }

      if (event.data.type === "viewer-fallback-error") {
        cleanup();
        reject(new Error(event.data.message || "Embedded viewer failed to load IFC."));
      }
    }

    window.addEventListener("message", onMessage);
    fallbackFrame.contentWindow.postMessage(
      {
        type: "load-ifc-buffer",
        name: file.name,
        buffer,
      },
      "*",
      [buffer],
    );
  });
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
