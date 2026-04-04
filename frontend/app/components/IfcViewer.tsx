"use client";

import { useEffect, useRef, useState } from "react";

type IfcApi = {
  setWasmPath: (path: string) => Promise<void> | void;
  applyWebIfcConfig: (config: { COORDINATE_TO_ORIGIN: boolean; USE_FAST_BOOLS: boolean }) => Promise<void> | void;
  loadIfc: (file: File, fitToFrame?: boolean, onError?: (err: unknown) => void) => Promise<{ modelID: number } | null>;
  removeIfcModel: (modelID: number) => void;
  loader?: {
    ifcManager?: {
      ifcAPI?: {
        SetWasmPath?: (path: string, absolute?: boolean) => void;
      };
    };
  };
};

type IfcViewerApi = {
  IFC: IfcApi;
  dispose: () => Promise<void> | void;
};

export default function IfcViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<IfcViewerApi | null>(null);
  const loadedModelIdRef = useRef<number | null>(null);
  const [status, setStatus] = useState("Viewer ready. Upload an IFC file to start.");

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!containerRef.current) return;

      const wasmPath = "/wasm/";
      const wasmAbsolutePath = `${window.location.origin}${wasmPath}`;
      const wasmHealth = await fetch(`${wasmPath}web-ifc.wasm`, { method: "HEAD" });
      if (!wasmHealth.ok) {
        throw new Error(`WASM not reachable at ${wasmPath}web-ifc.wasm`);
      }

      const { IfcViewerAPI } = await import("web-ifc-viewer");

      if (cancelled || !containerRef.current) return;

      const viewer = new IfcViewerAPI({
        container: containerRef.current,
        backgroundColor: new (await import("three")).Color(0xf7f9fc),
      }) as unknown as IfcViewerApi;

      // web-ifc defaults SetWasmPath to relative mode, which can generate invalid URLs in bundled runtimes.
      await viewer.IFC.setWasmPath(wasmPath);
      viewer.IFC.loader?.ifcManager?.ifcAPI?.SetWasmPath?.(wasmAbsolutePath, true);
      await viewer.IFC.applyWebIfcConfig({
        COORDINATE_TO_ORIGIN: true,
        USE_FAST_BOOLS: true,
      });

      viewerRef.current = viewer;
    };

    init().catch((error: unknown) => {
      console.error(error);
      setStatus("Failed to initialize IFC viewer.");
    });

    return () => {
      cancelled = true;
      viewerRef.current?.dispose();
      viewerRef.current = null;
      loadedModelIdRef.current = null;
    };
  }, []);

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const viewer = viewerRef.current;
    if (!file || !viewer) return;

    try {
      setStatus(`Loading ${file.name}...`);

      // Re-apply absolute wasm path right before parsing to avoid runtime path resets.
      viewer.IFC.loader?.ifcManager?.ifcAPI?.SetWasmPath?.(`${window.location.origin}/wasm/`, true);

      if (loadedModelIdRef.current !== null) {
        viewer.IFC.removeIfcModel(loadedModelIdRef.current);
        loadedModelIdRef.current = null;
      }

      const model = await viewer.IFC.loadIfc(file, true, (err) => {
        console.error(err);
      });

      if (!model) {
        setStatus("Failed to load IFC file. The loader returned no model.");
        return;
      }

      loadedModelIdRef.current = model.modelID;

      setStatus(`Loaded ${file.name}`);
    } catch (error) {
      console.error(error);
      setStatus("Failed to load IFC file. Check console for details.");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <section className="viewer-shell">
      <div className="viewer-toolbar">
        <label className="upload-label" htmlFor="ifc-file">
          Upload IFC
        </label>
        <input id="ifc-file" type="file" accept=".ifc" onChange={onFileChange} />
        <p>{status}</p>
      </div>
      <div ref={containerRef} className="viewer-canvas" />
    </section>
  );
}