import Link from "next/link";

const sampleFiles = [
  {
    name: "Residential House.ifc",
    type: "IFC2x3",
    size: "7.2 MB",
    description: "Single-family house with slab, columns, and pitched roof.",
    href: "/dashboard/house",
  },
  {
    name: "Office Podium.ifc",
    type: "IFC4",
    size: "14.8 MB",
    description: "Mixed-use podium model with repeated floor bays.",
    href: "#",
  },
  {
    name: "Parking Block.ifc",
    type: "IFC4",
    size: "9.5 MB",
    description: "Open parking deck with ramp and retaining walls.",
    href: "#",
  },
];

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[#fffaf4] text-[#1b140f]">
      <header className="border-b-2 border-[#1b140f] bg-white">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-5 md:px-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#444]">Xenon Dashboard</p>
            <h1 className="text-2xl font-black tracking-tight md:text-3xl">Project Review Workspace</h1>
          </div>
          <Link
            href="/"
            className="rounded-full border-2 border-[#1b140f] bg-[#ff7a00] px-4 py-2 text-sm font-bold text-white"
          >
            Back to Landing
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-7xl px-5 py-10 md:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#555]">Sample IFC Files</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight md:text-4xl">Try a model instantly</h2>
          </div>
          <p className="max-w-md text-sm text-[#303030]">
            Start with a sample. Click on the house model to open an interactive three.js viewer with normal and immersive modes.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {sampleFiles.map((file) => {
            const isHouse = file.href === "/dashboard/house";
            const cardClass = isHouse
              ? "rounded-3xl border-2 border-[#1b140f] bg-[#ffb566] p-6 shadow-[6px_6px_0_0_#1b140f] transition-transform hover:-translate-y-1"
              : "rounded-3xl border-2 border-[#1b140f] bg-white p-6 opacity-90";

            return (
              <article key={file.name} className={cardClass}>
                <p className="font-mono text-xs uppercase tracking-[0.16em]">{file.type}</p>
                <h3 className="mt-3 text-2xl font-black leading-tight">{file.name}</h3>
                <p className="mt-1 text-sm text-[#2c2c2c]">{file.size}</p>
                <p className="mt-4 text-sm leading-6 text-[#2f2f2f]">{file.description}</p>
                {isHouse ? (
                  <Link
                    href={file.href}
                    className="mt-5 inline-flex rounded-full border-2 border-[#1b140f] bg-[#ff7a00] px-5 py-2 text-sm font-bold text-white"
                  >
                    Open House Viewer
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="mt-5 rounded-full border-2 border-[#1b140f] bg-[#fff1e2] px-5 py-2 text-sm font-bold"
                    disabled
                  >
                    Coming Soon
                  </button>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
