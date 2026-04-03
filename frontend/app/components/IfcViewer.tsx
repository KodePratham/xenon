"use client";

import { useEffect, useRef, useState } from "react";

type IfcApi = {
  loadIfcUrl: (ifcUrl: string) => Promise<{ modelID: number }>;
  IFCModel: {
    close: (modelID: number, scene: unknown) => Promise<void>;
  };
};

type IfcContext = {
  scene: unknown;
};

type IfcManager = {
  setWasmPath: (path: string) => void;
  applyWebIfcConfig: (config: { COORDINATE_TO_ORIGIN: boolean; USE_FAST_BOOLS: boolean }) => void;
};

type IfcLoader = {
  ifcManager: IfcManager;
};

type IfcViewerApi = {
  context: IfcContext;
  IFCLoader: IfcLoader;
  IFC: IfcApi;
  dispose: () => void;
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

      const { IfcViewerAPI } = await import("web-ifc-viewer");

      if (cancelled || !containerRef.current) return;

      const viewer = new IfcViewerAPI({
        container: containerRef.current,
        backgroundColor: new (await import("three")).Color(0xf7f9fc),
      }) as unknown as IfcViewerApi;

      viewer.IFCLoader.ifcManager.setWasmPath("https://unpkg.com/web-ifc@0.0.68/");
      viewer.IFCLoader.ifcManager.applyWebIfcConfig({
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

      if (loadedModelIdRef.current !== null) {
        await viewer.IFC.IFCModel.close(loadedModelIdRef.current, viewer.context.scene);
      }

      const ifcURL = URL.createObjectURL(file);
      const model = await viewer.IFC.loadIfcUrl(ifcURL);
      loadedModelIdRef.current = model.modelID as number;
      URL.revokeObjectURL(ifcURL);

      setStatus(`Loaded ${file.name}`);
    } catch (error) {
      console.error(error);
      setStatus("Failed to load IFC file. Check console for details.");
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