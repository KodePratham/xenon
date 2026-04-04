import IfcViewer from "./components/IfcViewer";

export default function Home() {
  return (
    <main className="app-shell">
      <header>
        <h1>IFC File Viewer</h1>
        <p>Upload an IFC file from your machine and preview it in 3D.</p>
      </header>
      <IfcViewer />
      <footer>
        <small>Tip: use smaller files first to verify load speed and geometry quality.</small>
      </footer>
      </main>
  );
}
