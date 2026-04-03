import IfcViewer from "./components/IfcViewer";

export default function Home() {
  return (
    <main className="app-shell">
      <header>
        <h1>IFC Architecture Frontend</h1>
        <p>Next.js + web-ifc-viewer + three.js starter workspace</p>
      </header>
      <IfcViewer />
      <footer>
        <small>Tip: start with small IFC files and increase model complexity gradually.</small>
      </footer>
      </main>
  );
}
