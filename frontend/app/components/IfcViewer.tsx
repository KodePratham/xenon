"use client";

import { useEffect, useRef, useState } from "react";

const GLASS_HINTS = ["glass", "glaz", "window", "curtain"];
const INTERIOR_FADE_HINTS = ["wall", "slab", "covering", "ceiling", "roof", "column", "beam"];
const INTERIOR_HIDE_HINTS = ["roof", "ceiling", "covering"];

type QualityMode = "Balanced" | "High";

type ViewerMaterial = {
  uuid?: string;
  name?: string;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  alphaTest?: number;
  metalness?: number;
  roughness?: number;
  transmission?: number;
  ior?: number;
  envMapIntensity?: number;
  needsUpdate?: boolean;
};

type ViewerObject = {
  name?: string;
  type?: string;
  visible?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  material?: ViewerMaterial | ViewerMaterial[];
  traverse?: (cb: (child: ViewerObject) => void) => void;
};

type MaterialSnapshot = {
  transparent: boolean;
  opacity: number;
  depthWrite: boolean;
  alphaTest: number;
  metalness?: number;
  roughness?: number;
  transmission?: number;
  ior?: number;
  envMapIntensity?: number;
};

type MaybeRenderer = {
  setPixelRatio?: (ratio: number) => void;
  toneMapping?: number;
  toneMappingExposure?: number;
  physicallyCorrectLights?: boolean;
  outputEncoding?: number;
  outputColorSpace?: string;
  shadowMap?: {
    enabled?: boolean;
    autoUpdate?: boolean;
    type?: number;
  };
  xr?: {
    setSession?: (session: XRSession | null) => Promise<void>;
  };
};

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
  context?: {
    ifcCamera?: {
      setNavigationMode?: (mode: string) => void;
      fitModelToFrame?: () => void;
    };
    renderer?: {
      renderer?: MaybeRenderer;
      postProduction?: {
        active?: boolean;
      };
    };
    scene?: {
      getScene?: () => unknown;
      scene?: unknown;
    };
    grid?: {
      setGrid?: (enabled: boolean) => void;
    };
    axes?: {
      setAxes?: (enabled: boolean) => void;
    };
  };
  grid?: {
    setGrid?: (enabled: boolean) => void;
  };
  axes?: {
    setAxes?: (enabled: boolean) => void;
  };
  dispose: () => Promise<void> | void;
};

export default function IfcViewer() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<IfcViewerApi | null>(null);
  const loadedModelRef = useRef<ViewerObject | null>(null);
  const loadedModelIdRef = useRef<number | null>(null);
  const lightRigRef = useRef<unknown>(null);
  const materialSnapshotsRef = useRef<Map<string, MaterialSnapshot>>(new Map());
  const visibilitySnapshotsRef = useRef<WeakMap<ViewerObject, boolean>>(new WeakMap());
  const [status, setStatus] = useState("Viewer ready. Upload an IFC file to start.");
  const [isImmersiveSupported, setIsImmersiveSupported] = useState(false);
  const [isImmersiveActive, setIsImmersiveActive] = useState(false);
  const [isGridVisible, setIsGridVisible] = useState(true);
  const [isAxesVisible, setIsAxesVisible] = useState(true);
  const [qualityMode, setQualityMode] = useState<QualityMode>("High");
  const [isInteriorMode, setIsInteriorMode] = useState(false);
  const [glassOpacity, setGlassOpacity] = useState(0.28);
  const [exposure, setExposure] = useState(1.05);
  const [lightBoost, setLightBoost] = useState(1.15);
  const xrSessionRef = useRef<XRSession | null>(null);

  const hasHint = (value: string, hints: string[]) => hints.some((hint) => value.includes(hint));

  const getMaterialList = (item: ViewerObject): ViewerMaterial[] => {
    if (!item.material) return [];
    return Array.isArray(item.material) ? item.material : [item.material];
  };

  const rememberMaterial = (material: ViewerMaterial) => {
    const uuid = material.uuid;
    if (!uuid || materialSnapshotsRef.current.has(uuid)) return;

    materialSnapshotsRef.current.set(uuid, {
      transparent: Boolean(material.transparent),
      opacity: typeof material.opacity === "number" ? material.opacity : 1,
      depthWrite: material.depthWrite !== false,
      alphaTest: typeof material.alphaTest === "number" ? material.alphaTest : 0,
      metalness: material.metalness,
      roughness: material.roughness,
      transmission: material.transmission,
      ior: material.ior,
      envMapIntensity: material.envMapIntensity,
    });
  };

  const rememberVisibility = (item: ViewerObject) => {
    if (!visibilitySnapshotsRef.current.has(item)) {
      visibilitySnapshotsRef.current.set(item, item.visible !== false);
    }
  };

  const restoreModelOverrides = () => {
    const modelRoot = loadedModelRef.current;
    if (!modelRoot?.traverse) return;

    modelRoot.traverse((child) => {
      const previousVisibility = visibilitySnapshotsRef.current.get(child);
      if (typeof previousVisibility === "boolean") {
        child.visible = previousVisibility;
      }

      for (const material of getMaterialList(child)) {
        const snapshot = material.uuid ? materialSnapshotsRef.current.get(material.uuid) : undefined;
        if (!snapshot) continue;

        material.transparent = snapshot.transparent;
        material.opacity = snapshot.opacity;
        material.depthWrite = snapshot.depthWrite;
        material.alphaTest = snapshot.alphaTest;

        if (typeof snapshot.metalness === "number") material.metalness = snapshot.metalness;
        if (typeof snapshot.roughness === "number") material.roughness = snapshot.roughness;
        if (typeof snapshot.transmission === "number") material.transmission = snapshot.transmission;
        if (typeof snapshot.ior === "number") material.ior = snapshot.ior;
        if (typeof snapshot.envMapIntensity === "number") material.envMapIntensity = snapshot.envMapIntensity;

        material.needsUpdate = true;
      }
    });
  };

  const getScene = (viewer: IfcViewerApi) => {
    const sceneContext = viewer.context?.scene as { getScene?: () => unknown; scene?: unknown } | undefined;
    return sceneContext?.getScene?.() ?? sceneContext?.scene ?? null;
  };

  const configureRenderer = async (viewer: IfcViewerApi) => {
    const renderer = viewer.context?.renderer?.renderer;
    if (!renderer) return;

    const three = await import("three");
    const threeAny = three as unknown as Record<string, unknown>;

    const srgbEncoding = typeof threeAny.sRGBEncoding === "number" ? (threeAny.sRGBEncoding as number) : undefined;
    const srgbColorSpace = typeof threeAny.SRGBColorSpace === "string" ? (threeAny.SRGBColorSpace as string) : undefined;
    const acesToneMapping = typeof threeAny.ACESFilmicToneMapping === "number" ? (threeAny.ACESFilmicToneMapping as number) : renderer.toneMapping;
    const reinhardToneMapping = typeof threeAny.ReinhardToneMapping === "number" ? (threeAny.ReinhardToneMapping as number) : renderer.toneMapping;
    const pcfSoftShadowMap = typeof threeAny.PCFSoftShadowMap === "number" ? (threeAny.PCFSoftShadowMap as number) : renderer.shadowMap?.type;
    const pcfShadowMap = typeof threeAny.PCFShadowMap === "number" ? (threeAny.PCFShadowMap as number) : renderer.shadowMap?.type;

    if (typeof renderer.setPixelRatio === "function") {
      const ratioCap = qualityMode === "High" ? 2 : 1.5;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratioCap));
    }

    if (typeof (renderer as { outputEncoding?: number }).outputEncoding === "number") {
      if (typeof srgbEncoding === "number") {
        renderer.outputEncoding = srgbEncoding;
      }
    }

    if ("outputColorSpace" in renderer && srgbColorSpace) {
      renderer.outputColorSpace = srgbColorSpace;
    }

    renderer.toneMapping = qualityMode === "High"
      ? acesToneMapping
      : reinhardToneMapping;
    renderer.toneMappingExposure = exposure;
    renderer.physicallyCorrectLights = true;

    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.autoUpdate = qualityMode === "High";
      renderer.shadowMap.type = qualityMode === "High"
        ? pcfSoftShadowMap
        : pcfShadowMap;
    }

    const post = viewer.context?.renderer?.postProduction;
    if (post && "active" in post) {
      post.active = qualityMode === "High";
    }
  };

  const configureLighting = async (viewer: IfcViewerApi) => {
    const scene = getScene(viewer) as {
      add?: (...objects: unknown[]) => void;
      remove?: (...objects: unknown[]) => void;
    } | null;

    if (!scene?.add || !scene.remove) return;

    const three = await import("three");

    if (lightRigRef.current) {
      scene.remove(lightRigRef.current);
    }

    const rig = new three.Group();
    rig.name = "xenon-light-rig";

    const ambient = new three.AmbientLight(0xffffff, 0.4 * lightBoost);
    const hemisphere = new three.HemisphereLight(0xeaf6ff, 0x2a3645, 0.62 * lightBoost);
    const key = new three.DirectionalLight(0xffffff, 0.95 * lightBoost);
    const fill = new three.DirectionalLight(0xd8e8ff, 0.48 * lightBoost);

    key.position.set(17, 26, 12);
    fill.position.set(-14, 10, -11);

    key.castShadow = true;
    key.shadow.mapSize.set(qualityMode === "High" ? 2048 : 1024, qualityMode === "High" ? 2048 : 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 140;

    fill.castShadow = qualityMode === "High";

    rig.add(ambient, hemisphere, key, fill);
    scene.add(rig);
    lightRigRef.current = rig;
  };

  const applyMaterialOverrides = () => {
    const modelRoot = loadedModelRef.current;
    if (!modelRoot?.traverse) return;

    restoreModelOverrides();

    modelRoot.traverse((child) => {
      const labelBase = `${child.name ?? ""} ${child.type ?? ""}`.toLowerCase();

      if (isInteriorMode && hasHint(labelBase, INTERIOR_HIDE_HINTS)) {
        rememberVisibility(child);
        child.visible = false;
      }

      if (typeof child.castShadow === "boolean") child.castShadow = true;
      if (typeof child.receiveShadow === "boolean") child.receiveShadow = true;

      for (const material of getMaterialList(child)) {
        rememberMaterial(material);

        const label = `${labelBase} ${material.name ?? ""}`.toLowerCase();

        if (hasHint(label, GLASS_HINTS)) {
          material.transparent = true;
          material.opacity = glassOpacity;
          material.depthWrite = false;
          material.alphaTest = 0;
          material.roughness = 0.1;
          material.metalness = 0;
          material.transmission = 0.75;
          material.ior = 1.45;
          material.envMapIntensity = 1;
          material.needsUpdate = true;
        }

        if (isInteriorMode && hasHint(label, INTERIOR_FADE_HINTS)) {
          material.transparent = true;
          material.opacity = Math.min(material.opacity ?? 1, 0.2);
          material.depthWrite = false;
          material.needsUpdate = true;
        }
      }
    });
  };

  const clearModelState = () => {
    restoreModelOverrides();
    loadedModelRef.current = null;
    materialSnapshotsRef.current.clear();
    visibilitySnapshotsRef.current = new WeakMap();
  };

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

      await configureRenderer(viewer);
      await configureLighting(viewer);
      setStatus("Viewer ready. High quality mode enabled.");
    };

    init().catch((error: unknown) => {
      console.error(error);
      setStatus("Failed to initialize IFC viewer.");
    });

    return () => {
      cancelled = true;
      xrSessionRef.current?.end().catch(() => {
        // Ignore cleanup failures when ending a stale XR session.
      });

      viewerRef.current?.dispose();
      viewerRef.current = null;
      lightRigRef.current = null;
      clearModelState();
      loadedModelIdRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    configureRenderer(viewer).catch((error: unknown) => {
      console.error(error);
      setStatus("Could not fully apply renderer quality settings.");
    });

    configureLighting(viewer).catch((error: unknown) => {
      console.error(error);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exposure, lightBoost, qualityMode]);

  useEffect(() => {
    applyMaterialOverrides();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glassOpacity, isInteriorMode]);

  useEffect(() => {
    const checkImmersiveSupport = async () => {
      if (typeof navigator === "undefined" || !("xr" in navigator) || !navigator.xr) {
        setIsImmersiveSupported(false);
        return;
      }

      try {
        const supported = await navigator.xr.isSessionSupported("immersive-vr");
        setIsImmersiveSupported(supported);
      } catch {
        setIsImmersiveSupported(false);
      }
    };

    checkImmersiveSupport();
  }, []);

  const setNavigationMode = (mode: "Orbit" | "FirstPerson") => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.context?.ifcCamera?.setNavigationMode?.(mode);
    setStatus(mode === "Orbit" ? "Navigation mode: Orbit" : "Navigation mode: Walk");
  };

  const resetView = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    viewer.context?.ifcCamera?.fitModelToFrame?.();
    setStatus("View reset to fit model.");
  };

  const toggleGrid = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const next = !isGridVisible;
    viewer.context?.grid?.setGrid?.(next);
    viewer.grid?.setGrid?.(next);
    setIsGridVisible(next);
  };

  const toggleAxes = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const next = !isAxesVisible;
    viewer.context?.axes?.setAxes?.(next);
    viewer.axes?.setAxes?.(next);
    setIsAxesVisible(next);
  };

  const toggleImmersiveMode = async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    if (!navigator.xr || !isImmersiveSupported) {
      setStatus("Immersive mode is not supported on this device/browser.");
      return;
    }

    const renderer = viewer.context?.renderer?.renderer;
    if (!renderer?.xr?.setSession) {
      setStatus("Immersive mode unavailable: renderer XR hooks not found.");
      return;
    }

    if (xrSessionRef.current) {
      await xrSessionRef.current.end();
      return;
    }

    try {
      const session = await navigator.xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking"],
      });

      xrSessionRef.current = session;
      await renderer.xr.setSession(session);
      setIsImmersiveActive(true);
      setStatus("Immersive mode started. Put on your headset to explore the model at human scale.");

      session.addEventListener("end", () => {
        xrSessionRef.current = null;
        setIsImmersiveActive(false);
        setStatus("Immersive mode ended.");
      });
    } catch (error) {
      console.error(error);
      setStatus("Could not start immersive mode. Connect a headset and allow XR permissions.");
    }
  };

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const viewer = viewerRef.current;
    if (!file || !viewer) return;

    try {
      setStatus(`Loading ${file.name}...`);

      // Re-apply absolute wasm path right before parsing to avoid runtime path resets.
      viewer.IFC.loader?.ifcManager?.ifcAPI?.SetWasmPath?.(`${window.location.origin}/wasm/`, true);

      if (loadedModelIdRef.current !== null) {
        clearModelState();
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
      loadedModelRef.current = model as unknown as ViewerObject;

      applyMaterialOverrides();

      setStatus(`Loaded ${file.name}. ${qualityMode} quality profile active.`);
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
        <div className="viewer-controls" role="group" aria-label="Viewer controls">
          <button type="button" onClick={() => setNavigationMode("Orbit")}>Orbit</button>
          <button type="button" onClick={() => setNavigationMode("FirstPerson")}>Walk</button>
          <button type="button" onClick={resetView}>Reset View</button>
          <button type="button" onClick={toggleGrid}>{isGridVisible ? "Hide Grid" : "Show Grid"}</button>
          <button type="button" onClick={toggleAxes}>{isAxesVisible ? "Hide Axes" : "Show Axes"}</button>
          <button
            type="button"
            onClick={() => setQualityMode("Balanced")}
            className={qualityMode === "Balanced" ? "is-active" : ""}
          >
            Balanced
          </button>
          <button
            type="button"
            onClick={() => setQualityMode("High")}
            className={qualityMode === "High" ? "is-active" : ""}
          >
            High
          </button>
          <button
            type="button"
            onClick={toggleImmersiveMode}
            disabled={!isImmersiveSupported}
            title={isImmersiveSupported ? "Start immersive VR mode" : "WebXR immersive-vr not supported on this device"}
          >
            {isImmersiveActive ? "Exit Immersive" : "Enter Immersive"}
          </button>
        </div>

        <div className="viewer-advanced-controls" role="group" aria-label="Visual quality controls">
          <label>
            <input
              type="checkbox"
              checked={isInteriorMode}
              onChange={(event) => setIsInteriorMode(event.target.checked)}
            />
            Interior Inspect
          </label>

          <label>
            Glass {Math.round(glassOpacity * 100)}%
            <input
              type="range"
              min={0.08}
              max={0.85}
              step={0.01}
              value={glassOpacity}
              onChange={(event) => setGlassOpacity(Number(event.target.value))}
            />
          </label>

          <label>
            Exposure {exposure.toFixed(2)}
            <input
              type="range"
              min={0.65}
              max={1.55}
              step={0.01}
              value={exposure}
              onChange={(event) => setExposure(Number(event.target.value))}
            />
          </label>

          <label>
            Lighting {lightBoost.toFixed(2)}x
            <input
              type="range"
              min={0.7}
              max={1.7}
              step={0.01}
              value={lightBoost}
              onChange={(event) => setLightBoost(Number(event.target.value))}
            />
          </label>
        </div>
        <p>{status}</p>
      </div>
      <div ref={containerRef} className="viewer-canvas" />
    </section>
  );
}