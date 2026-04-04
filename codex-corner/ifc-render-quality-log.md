# IFC Render Quality Work Log

Date: 2026-04-04
Scope: Improve IFC visual quality for interiors, glass, and edge smoothness in the frontend viewer.

## Changes Implemented

1. Added renderer quality profiles in viewer UI.
- `Balanced` and `High` mode buttons now update renderer pipeline settings.
- Renderer now applies tone mapping, exposure, physically-correct lights, pixel ratio limits, and shadow map strategy based on selected profile.

2. Added dedicated lighting rig for architectural readability.
- Ambient + hemisphere + directional key/fill lights are injected into the Three.js scene.
- Shadow quality scales with quality profile.
- Lighting intensity is user-adjustable via toolbar slider.

3. Added interior inspection controls.
- `Interior Inspect` toggle now reduces occlusion by hiding/fading selected structural labels (roof/ceiling/covering classes by name hints) to expose room interiors quickly.

4. Added glass material handling.
- Material label hints (`glass`, `glaz`, `window`, `curtain`) receive transparent rendering profile.
- Glass opacity is user-adjustable via slider and defaults to a realistic translucent setting.

5. Added safe material/visibility state snapshots.
- Original material and visibility values are captured before overrides.
- Overrides are restored before applying new state to avoid cumulative corruption.

6. Updated UX copy and toolbar styles.
- New controls styled for clarity.
- Header/footer text now reflects quality workflow guidance.

## Files Updated

- frontend/app/components/IfcViewer.tsx
- frontend/app/globals.css
- frontend/app/page.tsx

## Notes for Future Iterations

1. Current interior/glass logic relies on name/type heuristics and may vary by IFC export style.
2. A stronger next step is IFC-category-aware overrides using explicit IFC type IDs from loader metadata.
3. If FPS drops on heavy scenes, implement automatic downgrade from High to Balanced after sustained low frame rate.
4. For near-photoreal output, add optional AO/postprocessing with dynamic quality scaling.

## Validation Checklist

- Lint/build pass after code changes.
- Manual test with medium IFC file (25-150 MB).
- Confirm interiors visible with `Interior Inspect`.
- Confirm glass transparency with opacity slider.
- Confirm jagged edge reduction and improved depth under `High` mode.
