import IfcViewer from "./components/IfcViewer";

export default function Home() {
  return (
    <main className="app-shell">
      <header>
        <h1>IFC File Viewer</h1>
        <p>Upload an IFC file and tune quality, glass, and interior inspection controls for cleaner architectural review.</p>
      </header>
      <IfcViewer />
      <footer>
        <small>Tip: use Balanced mode for larger models and switch to High mode when you need visual inspection detail.</small>
      </footer>
      </main>
  );
}
