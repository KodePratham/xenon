"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls, PointerLockControls } from "@react-three/drei";
import { createXRStore, XR, useXR } from "@react-three/xr";

// ─────────────────────────────────────────────────────────────────────────────
// XR Store – created once at module level so it survives re-renders
// ─────────────────────────────────────────────────────────────────────────────
const xrStore = createXRStore({ offerSession: "immersive-vr" });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type ViewMode = "normal" | "immersive";
type ComplianceState = "idle" | "analyzing" | "failed" | "fixing" | "passed";
type KeyboardState = { w: boolean; a: boolean; s: boolean; d: boolean };
type StepStatus = "pending" | "running" | "done";
type ProcessStep = {
  id: string;
  title: string;
  description: string;
  durationMs: number;
  status: StepStatus;
};
type VentilationMetrics = {
  roomName: string;
  floorAreaM2: number;
  openingAreaM2: number;
  requiredOpeningM2: number;
  ratioPercent: number;
  clause: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const roomFloorAreaM2 = 44.6;

const makeVentilationMetrics = (openingAreaM2: number): VentilationMetrics => {
  const requiredOpeningM2 = Number((roomFloorAreaM2 * 0.1).toFixed(2));
  const ratioPercent = Number(((openingAreaM2 / roomFloorAreaM2) * 100).toFixed(2));
  return {
    roomName: "Living + Bedroom Composite Zone",
    floorAreaM2: roomFloorAreaM2,
    openingAreaM2: Number(openingAreaM2.toFixed(2)),
    requiredOpeningM2,
    ratioPercent,
    clause: "NBC 2016 Part 8, Section 1 – Minimum openable area ≥ 10% of floor area",
  };
};

const failingMetrics = makeVentilationMetrics(3.38);
const passingMetrics = makeVentilationMetrics(5.36);

const processBlueprint: Omit<ProcessStep, "status">[] = [
  { id: "rule-review",     title: "Reviewing NBC 2016 rule file",    description: "Loaded ventilation clause references and extracted 10% threshold guidance.", durationMs: 7000 },
  { id: "rag-setup",       title: "Setting up RAG index",            description: "Chunked rule PDF text and prepared retrieval embeddings for code lookups.", durationMs: 7000 },
  { id: "ifc-parse",       title: "Parsing IFC geometry",            description: "Mapped room floor surfaces and existing openable window polygons.", durationMs: 8000 },
  { id: "rag-query",       title: "Querying clause context",         description: "Matched room tags to NBC ventilation clauses using semantic retrieval.", durationMs: 7000 },
  { id: "llm-remediation", title: "Using LLM to draft remediation",  description: "Generated candidate window size adjustments to satisfy the 10% rule.", durationMs: 8000 },
  { id: "model-patch",     title: "Applying geometry patch",         description: "Resized east and west facade windows in the structural model variant.", durationMs: 7000 },
  { id: "recheck",         title: "Re-running compliance checks",    description: "Computed new ventilation ratio and validated against NBC threshold.", durationMs: 8000 },
  { id: "publish",         title: "Publishing revised model",        description: "Updated report and switched viewer to the compliant house version.", durationMs: 8000 },
];

const totalFixMs = processBlueprint.reduce((sum, s) => sum + s.durationMs, 0);
const wait = (ms: number) => new Promise<void>((res) => window.setTimeout(res, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Design palette
// ─────────────────────────────────────────────────────────────────────────────
const WALL  = "#f0ece3"; // warm plaster white
const FRAME = "#1c1c1e"; // near-black frames & door
const CONC  = "#b4b0aa"; // concrete (foundation, steps, path, canopy)
const ROOF  = "#cdcac5"; // flat roof slab
const PAR   = "#c5c1bc"; // parapet cap
const TRUNK = "#6b4226"; // tree trunk

// ─────────────────────────────────────────────────────────────────────────────
// HouseModel
// ─────────────────────────────────────────────────────────────────────────────
function HouseModel({
  optimized,
  complianceState,
}: {
  optimized: boolean;
  complianceState: ComplianceState;
}) {
  const glassColor =
    complianceState === "failed" || complianceState === "fixing"
      ? "#ff8888"
      : "#82cce8";

  // ── compliance-driven window dimensions (logic unchanged) ──────────────────
  const lwh = optimized ? 1.9  : 1.2; // left window height
  const lww = optimized ? 3.6  : 3.0; // left window width
  const lbh = optimized ? 0.65 : 1.0; // left below-section height
  const lby = optimized ? 0.52 : 0.7; // left below-section Y
  const lth = optimized ? 0.45 : 0.8; // left above-section height
  const lty = optimized ? 3.08 : 2.9; // left above-section Y

  const rwh = optimized ? 1.8  : 1.2;
  const rww = optimized ? 3.1  : 2.5;
  const rbh = optimized ? 0.72 : 1.0;
  const rby = optimized ? 0.56 : 0.7;
  const rth = optimized ? 0.48 : 0.8;
  const rty = optimized ? 3.06 : 2.9;

  // Frame bar dimensions
  const FB = 0.13; // bar cross-section thickness
  const FP = 0.28; // protrusion depth (slightly wider than wall)

  return (
    <group>
      {/* ── GROUND ──────────────────────────────────────────────────────────── */}
      <mesh position={[0, -0.01, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#70b96c" roughness={1} />
      </mesh>

      {/* Concrete entrance path */}
      <mesh position={[0, 0.03, 9.5]} receiveShadow>
        <boxGeometry args={[2.2, 0.06, 9]} />
        <meshStandardMaterial color={CONC} roughness={0.95} />
      </mesh>

      {/* ── FOUNDATION ──────────────────────────────────────────────────────── */}
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[12.4, 0.3, 10.4]} />
        <meshStandardMaterial color={CONC} roughness={0.9} />
      </mesh>

      {/* ── FLOORS ──────────────────────────────────────────────────────────── */}
      {/* Living room */}
      <mesh position={[0, 0.31, 2]} receiveShadow>
        <boxGeometry args={[11.6, 0.02, 5.6]} />
        <meshStandardMaterial color="#e8e3d8" roughness={0.82} />
      </mesh>
      {/* Bedroom */}
      <mesh position={[0, 0.31, -2.3]} receiveShadow>
        <boxGeometry args={[11.6, 0.02, 4.8]} />
        <meshStandardMaterial color="#e3ddd4" roughness={0.82} />
      </mesh>

      {/* ── LEFT WALL ───────────────────────────────────────────────────────── */}
      {/* Living-room solid strip (no window) */}
      <mesh position={[-5.8, 1.8, 2]} castShadow receiveShadow>
        <boxGeometry args={[0.2, 3, 5.6]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Bedroom end-cap */}
      <mesh position={[-5.8, 1.8, -4.2]} castShadow receiveShadow>
        <boxGeometry args={[0.2, 3, 0.8]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Below-window panel */}
      <mesh position={[-5.8, lby, -2.3]} castShadow receiveShadow>
        <boxGeometry args={[0.2, lbh, 4.8]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Above-window panel */}
      <mesh position={[-5.8, lty, -2.3]} castShadow receiveShadow>
        <boxGeometry args={[0.2, lth, 4.8]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Glass */}
      <mesh position={[-5.8, 1.8, -2.3]}>
        <boxGeometry args={[0.12, lwh, lww]} />
        <meshStandardMaterial color={glassColor} transparent opacity={0.42} metalness={0.93} roughness={0.04} />
      </mesh>
      {/* Frame – top bar */}
      <mesh position={[-5.8, 1.8 + lwh / 2 + FB / 2, -2.3]} castShadow>
        <boxGeometry args={[FP, FB, lww + FB * 2]} />
        <meshStandardMaterial color={FRAME} roughness={0.4} />
      </mesh>
      {/* Frame – bottom bar */}
      <mesh position={[-5.8, 1.8 - lwh / 2 - FB / 2, -2.3]} castShadow>
        <boxGeometry args={[FP, FB, lww + FB * 2]} />
        <meshStandardMaterial color={FRAME} roughness={0.4} />
      </mesh>
      {/* Frame – far side bar */}
      <mesh position={[-5.8, 1.8, -2.3 - lww / 2 - FB / 2]} castShadow>
        <boxGeometry args={[FP, lwh, FB]} />
        <meshStandardMaterial color={FRAME} roughness={0.4} />
      </mesh>
      {/* Frame – near side bar */}
      <mesh position={[-5.8, 1.8, -2.3 + lww / 2 + FB / 2]} castShadow>
        <boxGeometry args={[FP, lwh, FB]} />
        <meshStandardMaterial color={FRAME} roughness={0.4} />
      </mesh>
      {/* Sill */}
      <mesh position={[-6.0, 1.8 - lwh / 2 - 0.04, -2.3]} castShadow>
        <boxGeometry args={[0.3, 0.07, lww + 0.42]} />
        <meshStandardMaterial color="#d5d1cb" roughness={0.72} />
      </mesh>

      {/* ── RIGHT WALL ──────────────────────────────────────────────────────── */}
      {/* Living-room end section */}
      <mesh position={[5.8, 1.8, 3.5]} castShadow receiveShadow>
        <boxGeometry args={[0.2, 3, 2.6]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Below-window panel */}
      <mesh position={[5.8, rby, 0.7]} castShadow receiveShadow>
        <boxGeometry args={[0.2, rbh, 3.4]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Above-window panel */}
      <mesh position={[5.8, rty, 0.7]} castShadow receiveShadow>
        <boxGeometry args={[0.2, rth, 3.4]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Bedroom solid strip */}
      <mesh position={[5.8, 1.8, -2.3]} castShadow receiveShadow>
        <boxGeometry args={[0.2, 3, 4.8]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Glass */}
      <mesh position={[5.8, 1.8, 0.7]}>
        <boxGeometry args={[0.12, rwh, rww]} />
        <meshStandardMaterial color={glassColor} transparent opacity={0.42} metalness={0.93} roughness={0.04} />
      </mesh>
      {/* Frame – top */}
      <mesh position={[5.8, 1.8 + rwh / 2 + FB / 2, 0.7]} castShadow>
        <boxGeometry args={[FP, FB, rww + FB * 2]} />
        <meshStandardMaterial color={FRAME} roughness={0.4} />
      </mesh>
      {/* Frame – bottom */}
      <mesh position={[5.8, 1.8 - rwh / 2 - FB / 2, 0.7]} castShadow>
        <boxGeometry args={[FP, FB, rww + FB * 2]} />
        <meshStandardMaterial color={FRAME} roughness={0.4} />
      </mesh>
      {/* Frame – left side */}
      <mesh position={[5.8, 1.8, 0.7 - rww / 2 - FB / 2]} castShadow>
        <boxGeometry args={[FP, rwh, FB]} />
        <meshStandardMaterial color={FRAME} roughness={0.4} />
      </mesh>
      {/* Frame – right side */}
      <mesh position={[5.8, 1.8, 0.7 + rww / 2 + FB / 2]} castShadow>
        <boxGeometry args={[FP, rwh, FB]} />
        <meshStandardMaterial color={FRAME} roughness={0.4} />
      </mesh>
      {/* Sill */}
      <mesh position={[6.0, 1.8 - rwh / 2 - 0.04, 0.7]} castShadow>
        <boxGeometry args={[0.3, 0.07, rww + 0.42]} />
        <meshStandardMaterial color="#d5d1cb" roughness={0.72} />
      </mesh>

      {/* ── BACK WALL ───────────────────────────────────────────────────────── */}
      <mesh position={[0, 1.8, -4.9]} castShadow receiveShadow>
        <boxGeometry args={[11.6, 3, 0.2]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>

      {/* ── FRONT WALL (door opening) ────────────────────────────────────────── */}
      <mesh position={[-3.5, 2.4, 4.9]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 3.8, 0.2]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      <mesh position={[3.5, 2.4, 4.9]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 3.8, 0.2]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>
      {/* Transom above door */}
      <mesh position={[0, 3.1, 4.9]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.65, 0.2]} />
        <meshStandardMaterial color={WALL} roughness={0.88} />
      </mesh>

      {/* ── DOOR ────────────────────────────────────────────────────────────── */}
      {/* Leaf (open) */}
      <mesh position={[-0.55, 1.55, 4.82]} rotation={[0, 0.65, 0]} castShadow>
        <boxGeometry args={[1.1, 2.5, 0.06]} />
        <meshStandardMaterial color="#1a1a1e" roughness={0.25} metalness={0.18} />
      </mesh>
      {/* Frame – top */}
      <mesh position={[0, 2.84, 4.9]} castShadow>
        <boxGeometry args={[2.52, 0.12, 0.26]} />
        <meshStandardMaterial color={FRAME} roughness={0.42} />
      </mesh>
      {/* Frame – left jamb */}
      <mesh position={[-1.26, 1.55, 4.9]} castShadow>
        <boxGeometry args={[0.12, 2.58, 0.26]} />
        <meshStandardMaterial color={FRAME} roughness={0.42} />
      </mesh>
      {/* Frame – right jamb */}
      <mesh position={[1.26, 1.55, 4.9]} castShadow>
        <boxGeometry args={[0.12, 2.58, 0.26]} />
        <meshStandardMaterial color={FRAME} roughness={0.42} />
      </mesh>
      {/* Handle */}
      <mesh position={[-0.08, 1.55, 5.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.025, 0.28, 10]} />
        <meshStandardMaterial color="#a8a8a8" metalness={0.9} roughness={0.08} />
      </mesh>

      {/* ── ENTRANCE CANOPY ─────────────────────────────────────────────────── */}
      {/* Thin concrete slab */}
      <mesh position={[0, 2.96, 5.65]} castShadow>
        <boxGeometry args={[3.6, 0.1, 1.58]} />
        <meshStandardMaterial color={CONC} roughness={0.82} />
      </mesh>
      {/* Slim steel column – left */}
      <mesh position={[-1.62, 1.72, 6.32]} castShadow receiveShadow>
        <cylinderGeometry args={[0.065, 0.065, 2.55, 12]} />
        <meshStandardMaterial color={FRAME} roughness={0.35} metalness={0.38} />
      </mesh>
      {/* Slim steel column – right */}
      <mesh position={[1.62, 1.72, 6.32]} castShadow receiveShadow>
        <cylinderGeometry args={[0.065, 0.065, 2.55, 12]} />
        <meshStandardMaterial color={FRAME} roughness={0.35} metalness={0.38} />
      </mesh>

      {/* ── ENTRANCE STEPS ──────────────────────────────────────────────────── */}
      <mesh position={[0, 0.46, 5.66]} castShadow receiveShadow>
        <boxGeometry args={[2.8, 0.18, 0.52]} />
        <meshStandardMaterial color={CONC} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.64, 5.2]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 0.18, 0.52]} />
        <meshStandardMaterial color={CONC} roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.82, 4.76]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.18, 0.5]} />
        <meshStandardMaterial color={CONC} roughness={0.9} />
      </mesh>

      {/* ── INTERIOR DIVIDING WALL ──────────────────────────────────────────── */}
      <mesh position={[-3.5, 1.8, -0.5]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 3, 0.15]} />
        <meshStandardMaterial color="#f6f3ee" roughness={0.9} />
      </mesh>
      <mesh position={[3.5, 1.8, -0.5]} castShadow receiveShadow>
        <boxGeometry args={[4.6, 3, 0.15]} />
        <meshStandardMaterial color="#f6f3ee" roughness={0.9} />
      </mesh>
      {/* Section above interior doorway */}
      <mesh position={[0, 2.75, -0.5]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 1.1, 0.15]} />
        <meshStandardMaterial color="#f6f3ee" roughness={0.9} />
      </mesh>

      {/* ── CEILINGS ────────────────────────────────────────────────────────── */}
      <mesh position={[0, 3.3, 2]} receiveShadow>
        <boxGeometry args={[11.6, 0.04, 5.6]} />
        <meshStandardMaterial color="#fafafa" />
      </mesh>
      <mesh position={[0, 3.3, -2.3]} receiveShadow>
        <boxGeometry args={[11.6, 0.04, 4.8]} />
        <meshStandardMaterial color="#fafafa" />
      </mesh>

      {/* ── FLAT ROOF ───────────────────────────────────────────────────────── */}
      {/* Main slab */}
      <mesh position={[0, 3.54, 0]} castShadow>
        <boxGeometry args={[12.4, 0.2, 10.4]} />
        <meshStandardMaterial color={ROOF} roughness={0.9} />
      </mesh>
      {/* Parapet – front */}
      <mesh position={[0, 3.94, 5.25]} castShadow>
        <boxGeometry args={[12.4, 0.62, 0.22]} />
        <meshStandardMaterial color={PAR} roughness={0.86} />
      </mesh>
      {/* Parapet – back */}
      <mesh position={[0, 3.94, -5.25]} castShadow>
        <boxGeometry args={[12.4, 0.62, 0.22]} />
        <meshStandardMaterial color={PAR} roughness={0.86} />
      </mesh>
      {/* Parapet – left */}
      <mesh position={[-6.2, 3.94, 0]} castShadow>
        <boxGeometry args={[0.22, 0.62, 10.7]} />
        <meshStandardMaterial color={PAR} roughness={0.86} />
      </mesh>
      {/* Parapet – right */}
      <mesh position={[6.2, 3.94, 0]} castShadow>
        <boxGeometry args={[0.22, 0.62, 10.7]} />
        <meshStandardMaterial color={PAR} roughness={0.86} />
      </mesh>
      {/* Rooftop HVAC unit */}
      <mesh position={[-3.2, 3.77, -3.4]} castShadow>
        <boxGeometry args={[1.35, 0.44, 0.88]} />
        <meshStandardMaterial color="#a8a4a0" roughness={0.72} metalness={0.22} />
      </mesh>
      <mesh position={[-3.2, 4.0, -3.4]} castShadow>
        <cylinderGeometry args={[0.14, 0.14, 0.22, 8]} />
        <meshStandardMaterial color="#8e8a86" roughness={0.6} metalness={0.4} />
      </mesh>

      {/* ── LANDSCAPING ─────────────────────────────────────────────────────── */}
      {/* Front-left bush cluster */}
      <mesh position={[-3.9, 0.58, 6.7]} castShadow>
        <sphereGeometry args={[0.58, 10, 8]} />
        <meshStandardMaterial color="#357a30" roughness={1} />
      </mesh>
      <mesh position={[-2.9, 0.42, 7.05]} castShadow>
        <sphereGeometry args={[0.42, 10, 8]} />
        <meshStandardMaterial color="#3e8738" roughness={1} />
      </mesh>
      {/* Front-right bush cluster */}
      <mesh position={[3.9, 0.58, 6.7]} castShadow>
        <sphereGeometry args={[0.58, 10, 8]} />
        <meshStandardMaterial color="#357a30" roughness={1} />
      </mesh>
      <mesh position={[2.9, 0.42, 7.05]} castShadow>
        <sphereGeometry args={[0.42, 10, 8]} />
        <meshStandardMaterial color="#3e8738" roughness={1} />
      </mesh>
      {/* Left side bush */}
      <mesh position={[-6.9, 0.48, -1.2]} castShadow>
        <sphereGeometry args={[0.48, 10, 8]} />
        <meshStandardMaterial color="#357a30" roughness={1} />
      </mesh>
      {/* Right side bush */}
      <mesh position={[7.0, 0.48, 2.6]} castShadow>
        <sphereGeometry args={[0.48, 10, 8]} />
        <meshStandardMaterial color="#3d8038" roughness={1} />
      </mesh>

      {/* Tree – right */}
      <mesh position={[8.5, 0.95, -1.5]} castShadow receiveShadow>
        <cylinderGeometry args={[0.18, 0.23, 1.9, 9]} />
        <meshStandardMaterial color={TRUNK} roughness={1} />
      </mesh>
      <mesh position={[8.5, 2.7, -1.5]} castShadow>
        <sphereGeometry args={[1.18, 10, 8]} />
        <meshStandardMaterial color="#256c20" roughness={1} />
      </mesh>

      {/* Tree – left */}
      <mesh position={[-8.2, 0.95, 3.0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.15, 0.2, 1.9, 9]} />
        <meshStandardMaterial color={TRUNK} roughness={1} />
      </mesh>
      <mesh position={[-8.2, 2.55, 3.0]} castShadow>
        <sphereGeometry args={[0.96, 10, 8]} />
        <meshStandardMaterial color="#2d7228" roughness={1} />
      </mesh>

      {/* ── COMPLIANCE OVERLAY ──────────────────────────────────────────────── */}
      {optimized ? (
        <mesh position={[0, 3.67, 0]}>
          <boxGeometry args={[12.6, 0.02, 10.6]} />
          <meshStandardMaterial color="#9be7c8" transparent opacity={0.15} />
        </mesh>
      ) : null}
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ImmersiveMovement – keyboard walk; yields camera to XR when headset is on
// ─────────────────────────────────────────────────────────────────────────────
function ImmersiveMovement() {
  const { camera } = useThree();
  // When session is non-null the XR compositor is driving the camera
  const xrSession = useXR((state) => state.session);
  const keys = useRef<KeyboardState>({ w: false, a: false, s: false, d: false });

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k in keys.current) keys.current[k as keyof KeyboardState] = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k in keys.current) keys.current[k as keyof KeyboardState] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useFrame((_state, delta) => {
    if (xrSession) return; // headset controls camera – don't fight it
    const sp = 4, ss = 3;
    if (keys.current.w) camera.translateZ(-sp * delta);
    if (keys.current.s) camera.translateZ(sp * delta);
    if (keys.current.a) camera.translateX(-ss * delta);
    if (keys.current.d) camera.translateX(ss * delta);
    camera.position.set(
      Math.max(-5.4, Math.min(5.4, camera.position.x)),
      1.6,
      Math.max(-4.5, Math.min(4.5, camera.position.z)),
    );
  });

  // Don't render PointerLockControls inside a headset – nothing to lock
  if (xrSession) return null;
  return <PointerLockControls />;
}

// ─────────────────────────────────────────────────────────────────────────────
// ImmersiveNoticeBoard
// ─────────────────────────────────────────────────────────────────────────────
function ImmersiveNoticeBoard({
  complianceState,
  metrics,
}: {
  complianceState: ComplianceState;
  metrics: VentilationMetrics;
}) {
  const isPass = complianceState === "passed";
  return (
    <group position={[0, 1.7, -1.8]}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.9, 1.65, 0.08]} />
        <meshStandardMaterial color={isPass ? "#083b24" : "#4a0909"} />
      </mesh>
      <Html transform position={[0, 0, 0.07]} distanceFactor={2.2}>
        <div
          className={`w-72 rounded-lg border p-3 text-xs shadow-xl ${
            isPass
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-rose-200 bg-rose-50 text-rose-950"
          }`}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.18em]">
            NBC 2016 Ventilation Board
          </p>
          <h3 className="mt-1 text-base font-bold">
            {isPass ? "PASS: Ventilation Ratio Restored" : "FAIL: Ventilation Below 10%"}
          </h3>
          <p className="mt-2 leading-5">{metrics.clause}</p>
          <p className="mt-2 font-semibold">
            Opening ratio: {metrics.ratioPercent}% (required: 10%)
          </p>
          {!isPass ? (
            <p className="mt-2 font-medium">
              Use the AI fix flow from the right panel to resize windows.
            </p>
          ) : (
            <p className="mt-2 font-medium">
              Windows were expanded and rechecked by the agentic pipeline.
            </p>
          )}
        </div>
      </Html>
    </group>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scene – entire content wrapped in <XR> for Meta Quest support
// Lighting tuned for Quest: ≤3 lights, shadow map 1024²
// ─────────────────────────────────────────────────────────────────────────────
function Scene({
  mode,
  optimized,
  complianceState,
  metrics,
}: {
  mode: ViewMode;
  optimized: boolean;
  complianceState: ComplianceState;
  metrics: VentilationMetrics;
}) {
  return (
    <XR store={xrStore}>
      <color attach="background" args={["#c6e2f0"]} />
      <fog attach="fog" args={["#c6e2f0", 30, 120]} />

      <ambientLight intensity={0.74} />
      <directionalLight
        castShadow
        position={[10, 16, 8]}
        intensity={1.22}
        color="#fff6ea"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={0.5}
        shadow-camera-far={60}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      {/* Hemisphere light gives warm ground / cool sky bounce */}
      <hemisphereLight args={["#c6e2f0", "#78c475", 0.36]} />

      <HouseModel optimized={optimized} complianceState={complianceState} />

      {mode === "immersive" &&
      (complianceState === "failed" || complianceState === "passed") ? (
        <ImmersiveNoticeBoard complianceState={complianceState} metrics={metrics} />
      ) : null}

      {mode === "normal" ? (
        <OrbitControls
          target={[0, 1.5, 0]}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={6}
          maxDistance={32}
        />
      ) : (
        <ImmersiveMovement />
      )}
    </XR>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HousePage
// ─────────────────────────────────────────────────────────────────────────────
export default function HousePage() {
  const [mode, setMode] = useState<ViewMode>("normal");
  const [complianceState, setComplianceState] = useState<ComplianceState>("idle");
  const [designVersion, setDesignVersion] = useState<"original" | "optimized">("original");
  const [metrics, setMetrics] = useState<VentilationMetrics>(failingMetrics);
  const [processSteps, setProcessSteps] = useState<ProcessStep[]>(
    processBlueprint.map((s) => ({ ...s, status: "pending" })),
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  // null = still detecting, true/false = result
  const [vrSupported, setVrSupported] = useState<boolean | null>(null);

  // Detect WebXR support once on mount
  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.xr) {
      navigator.xr
        .isSessionSupported("immersive-vr")
        .then(setVrSupported)
        .catch(() => setVrSupported(false));
    } else {
      setVrSupported(false);
    }
  }, []);

  const isFixing = complianceState === "fixing";
  const completedSteps = processSteps.filter((s) => s.status === "done").length;
  const progressPercent = Math.min(100, Math.round((elapsedMs / totalFixMs) * 100));

  const activeStepTitle = useMemo(() => {
    const running = processSteps.find((s) => s.status === "running");
    return running?.title ?? "Waiting";
  }, [processSteps]);

  const resetProcess = () => {
    setProcessSteps(processBlueprint.map((s) => ({ ...s, status: "pending" })));
    setElapsedMs(0);
  };

  const handleAnalyze = () => {
    if (complianceState === "analyzing" || isFixing) return;
    setDesignVersion("original");
    setMetrics(failingMetrics);
    resetProcess();
    setComplianceState("analyzing");
    window.setTimeout(() => setComplianceState("failed"), 2100);
  };

  const handleFixWithAI = () => {
    if (complianceState !== "failed") return;
    if (mode === "immersive") setMode("normal");
    resetProcess();
    setComplianceState("fixing");
  };

  useEffect(() => {
    if (!isFixing) return;

    let cancelled = false;
    const tick = window.setInterval(() => {
      setElapsedMs((prev) => Math.min(prev + 1000, totalFixMs));
    }, 1000);

    const run = async () => {
      for (const step of processBlueprint) {
        if (cancelled) return;
        setProcessSteps((prev) =>
          prev.map((s) => {
            if (s.id === step.id) return { ...s, status: "running" };
            if (s.status === "running") return { ...s, status: "done" };
            return s;
          }),
        );
        await wait(step.durationMs);
        if (cancelled) return;
        setProcessSteps((prev) =>
          prev.map((s) => (s.id === step.id ? { ...s, status: "done" } : s)),
        );
      }
      if (cancelled) return;
      setElapsedMs(totalFixMs);
      setDesignVersion("optimized");
      setMetrics(passingMetrics);
      setComplianceState("passed");
    };

    void run();
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [isFixing]);

  const statusLabel = (() => {
    if (complianceState === "analyzing") return "Analyzing IFC + NBC rules";
    if (complianceState === "failed")    return "Failed: ventilation below 10%";
    if (complianceState === "fixing")    return "AI fix in progress";
    if (complianceState === "passed")    return "Passed after AI resize";
    return "Ready for dry-run";
  })();

  const statusClass = (() => {
    if (complianceState === "failed")  return "border-rose-300 bg-rose-50 text-rose-900";
    if (complianceState === "passed")  return "border-emerald-300 bg-emerald-50 text-emerald-900";
    if (complianceState === "fixing")  return "border-amber-300 bg-amber-50 text-amber-900";
    return "border-slate-300 bg-slate-50 text-slate-900";
  })();

  const timeLabel = `${String(Math.floor(elapsedMs / 1000 / 60)).padStart(2, "0")}:${String(
    Math.floor((elapsedMs / 1000) % 60),
  ).padStart(2, "0")}`;

  const vrLabel = vrSupported === null ? "Checking…" : vrSupported ? "Connect Quest" : "Quest N/A";
  const vrTitle = vrSupported
    ? "Enter immersive VR on Meta Quest – open this page in Meta Quest Browser over HTTPS"
    : "WebXR immersive-vr not available in this browser";

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
              Minimalist Architecture
            </p>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Modern House Model – Dry Run
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* View-mode toggle */}
            <div className="flex items-center gap-1 rounded-full border border-slate-300 bg-white p-1 text-sm shadow-sm">
              <button
                type="button"
                onClick={() => setMode("normal")}
                disabled={isFixing}
                className={`rounded-full px-4 py-1.5 font-medium transition-all disabled:opacity-50 ${
                  mode === "normal"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                Normal
              </button>
              <button
                type="button"
                onClick={() => setMode("immersive")}
                disabled={isFixing}
                className={`rounded-full px-4 py-1.5 font-medium transition-all disabled:opacity-50 ${
                  mode === "immersive"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                Immersive
              </button>
            </div>

            {/* ── Meta Quest / WebXR button ── */}
            <button
              type="button"
              title={vrTitle}
              disabled={!vrSupported}
              onClick={() => xrStore.enterXR("immersive-vr")}
              className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold shadow-sm transition-all ${
                vrSupported
                  ? "border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 active:scale-95"
                  : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
              }`}
            >
              {/* VR headset icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path d="M2.5 9A5.5 5.5 0 0 1 8 3.5h8A5.5 5.5 0 0 1 21.5 9v.5c0 1-.56 1.9-1.44 2.35l-1.3.65-.07.3A3.75 3.75 0 0 1 15 15h-.9c-.72.62-1.65 1-2.6 1s-1.88-.38-2.6-1H8a3.75 3.75 0 0 1-3.69-3.2l-.07-.3-1.3-.65A2.65 2.65 0 0 1 1.5 8.5v-.5L2.5 9Zm5.5-3A3.5 3.5 0 0 0 4.5 9.5v.14l1.88.94.1.47A1.75 1.75 0 0 0 8 12.5h1.17l.32.34A2.25 2.25 0 0 0 11.5 14c.6 0 1.17-.24 1.59-.65l.32-.35H14.5a1.75 1.75 0 0 0 1.72-1.45l.1-.47 1.88-.94V9.5A3.5 3.5 0 0 0 15.5 6h-7.5Z" />
              </svg>
              {vrLabel}
            </button>
          </div>
        </div>
      </header>

      {/* ── VR hint banner ─────────────────────────────────────────────────── */}
      {vrSupported === true && (
        <div className="border-b border-indigo-100 bg-indigo-50 px-5 py-2 text-center text-xs text-indigo-700 md:px-8">
          🥽&nbsp;<strong>Meta Quest ready</strong> — open this page in the{" "}
          <strong>Meta Quest Browser</strong> over HTTPS, then press{" "}
          <strong>Connect Quest</strong> to enter immersive VR.
        </div>
      )}

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <section className="mx-auto w-full max-w-7xl px-5 py-6 md:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            {mode === "normal"
              ? "Drag to orbit • Scroll to zoom • Click Analyse File to trigger the NBC ventilation dry run"
              : "Click canvas to lock pointer • W/A/S/D to walk inside • see the compliance board in immersive mode"}
          </p>
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-slate-900 underline decoration-2 underline-offset-2 hover:text-slate-700"
          >
            ← Back to Dashboard
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.45fr_0.55fr]">
          {/* 3-D Canvas */}
          <div className="h-[75vh] min-h-[500px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <Canvas
              shadows
              gl={{ antialias: true, alpha: false }}
              camera={{
                position: mode === "normal" ? [14, 9, 14] : [0, 1.6, 3],
                fov: mode === "normal" ? 48 : 75,
                near: 0.05,
                far: 200,
              }}
            >
              <Scene
                mode={mode}
                optimized={designVersion === "optimized"}
                complianceState={complianceState}
                metrics={metrics}
              />
            </Canvas>
          </div>

          {/* Sidebar */}
          <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            {/* Status */}
            <div className={`rounded-lg border p-3 text-sm ${statusClass}`}>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em]">
                Compliance Status
              </p>
              <p className="mt-2 text-base font-semibold">{statusLabel}</p>
              <p className="mt-2 text-xs leading-5">{metrics.clause}</p>
            </div>

            {/* Metrics */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p>Model: <span className="font-semibold">Residential House.ifc</span></p>
              <p>Zone: <span className="font-semibold">{metrics.roomName}</span></p>
              <p>Floor area: <span className="font-semibold">{metrics.floorAreaM2} m²</span></p>
              <p>Openable area: <span className="font-semibold">{metrics.openingAreaM2} m²</span></p>
              <p>Required (10%): <span className="font-semibold">{metrics.requiredOpeningM2} m²</span></p>
              <p>Ratio: <span className="font-semibold">{metrics.ratioPercent}%</span></p>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={complianceState === "analyzing" || isFixing}
                className="rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {complianceState === "analyzing" ? "Analyzing…" : "Analyse File"}
              </button>
              <button
                type="button"
                onClick={handleFixWithAI}
                disabled={complianceState !== "failed"}
                className="rounded-full border border-emerald-800 bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Fix with AI
              </button>
            </div>

            {isFixing ? (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                AI remediation is running. Stay in Normal mode while the model is being updated.
              </div>
            ) : null}

            {/* Pipeline */}
            <div className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span className="font-mono uppercase tracking-[0.16em]">Live Agent Pipeline</span>
                <span>{timeLabel} / 01:00</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {isFixing
                  ? `Running: ${activeStepTitle}`
                  : complianceState === "passed"
                    ? "Pipeline complete. Updated model loaded."
                    : "Pipeline will start after a failed analysis."}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Steps completed: {completedSteps} / {processBlueprint.length}
              </p>

              <div className="mt-3 space-y-2">
                {processSteps.map((step) => {
                  const pillClass =
                    step.status === "done"
                      ? "bg-emerald-100 text-emerald-800"
                      : step.status === "running"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-slate-100 text-slate-500";
                  const pillText =
                    step.status === "done"
                      ? "Done"
                      : step.status === "running"
                        ? "Running"
                        : "Queued";

                  return (
                    <div key={step.id} className="rounded-md border border-slate-200 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-800">{step.title}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${pillClass}`}>
                          {pillText}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-slate-500">{step.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>

        {/* Footer info cards */}
        <div className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">Design</h3>
            <p className="mt-1 text-slate-600">
              Minimalist flat-roof house — dark frames, parapet, canopy, steps &amp; landscaping
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">Rule</h3>
            <p className="mt-1 text-slate-600">
              NBC 2016 10% ventilation check against computed openable window area
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h3 className="font-semibold text-slate-900">VR / Meta Quest</h3>
            <p className="mt-1 text-slate-600">
              WebXR via @react-three/xr v6 — open in Meta Quest Browser over HTTPS and press{" "}
              <strong>Connect Quest</strong>
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}