import Link from "next/link";

const features = [
  {
    title: "Code-Aware IFC Review",
    text: "Upload IFC files and get instant checks against local and international structural code logic.",
  },
  {
    title: "Collaborative Markups",
    text: "Pin comments to elements, assign fixes, and keep engineers, architects, and PMs in sync.",
  },
  {
    title: "Approval Timelines",
    text: "Track every revision, every decision, and every reviewer in one immutable timeline.",
  },
];

const stats = [
  { label: "Design reviews", value: "12k+" },
  { label: "Avg. review time cut", value: "68%" },
  { label: "Compliance confidence", value: "99.1%" },
];

const plans = [
  {
    name: "Starter",
    price: "$49",
    target: "solo consultants",
    points: ["3 active projects", "Standard IFC checks", "Email support"],
  },
  {
    name: "Studio",
    price: "$199",
    target: "design teams",
    points: ["25 active projects", "Team comments + workflows", "Priority support"],
  },
  {
    name: "Enterprise",
    price: "Custom",
    target: "large organizations",
    points: ["Unlimited projects", "Private deployment", "Custom code packs"],
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#fffaf4] text-[#1b140f]">
      <div className="relative overflow-hidden border-b-2 border-[#1b140f] bg-[linear-gradient(130deg,#fffaf4_0%,#fffaf4_38%,#ffb566_100%)]">
        <div className="pointer-events-none absolute -right-36 -top-36 h-96 w-96 rounded-full border-2 border-[#1b140f] bg-[#ff8c3a]/35 blur-3xl" />
        <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-6 md:px-8">
          <div className="rounded-full border-2 border-[#1b140f] bg-white px-5 py-1 font-mono text-sm font-semibold uppercase tracking-[0.22em]">
            Xenon
          </div>
          <nav className="hidden items-center gap-8 text-sm font-semibold md:flex">
            <a href="#features" className="hover:underline">
              Product
            </a>
            <a href="#pricing" className="hover:underline">
              Pricing
            </a>
            <a href="#faq" className="hover:underline">
              FAQ
            </a>
          </nav>
          <Link
            href="/dashboard"
            className="rounded-full border-2 border-[#1b140f] bg-[#ff7a00] px-5 py-2 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
          >
            Go to Dashboard
          </Link>
        </header>

        <section className="mx-auto grid w-full max-w-7xl gap-10 px-5 pb-14 pt-4 md:grid-cols-[1.05fr_0.95fr] md:items-center md:px-8 md:pb-20">
          <div className="space-y-8">
            <p className="inline-flex rounded-full border-2 border-[#1b140f] bg-white px-4 py-1 text-xs font-bold uppercase tracking-[0.16em]">
              Built for structural teams shipping fast
            </p>
            <h1 className="max-w-2xl text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">
              Review IFC models like a product launch, not a paperwork queue.
            </h1>
            <p className="max-w-xl text-lg leading-7 text-[#242424]">
              Xenon blends AI-assisted model checks, human review workflows, and instant
              collaboration so your team catches issues before the site does.
            </p>
            <div className="flex flex-wrap gap-4">
              <Link
                href="/dashboard"
                className="rounded-full border-2 border-[#1b140f] bg-[#ff7a00] px-8 py-3 text-base font-bold text-white transition-transform hover:-translate-y-1"
              >
                Start Reviewing
              </Link>
              <a
                href="#features"
                className="rounded-full border-2 border-[#1b140f] bg-white px-8 py-3 text-base font-bold"
              >
                Explore Features
              </a>
            </div>
          </div>

          <div className="grid gap-4">
            <article className="rotate-[-1.5deg] rounded-3xl border-2 border-[#1b140f] bg-white p-6 shadow-[8px_8px_0_0_#1b140f]">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#444]">Live Review Feed</p>
              <h2 className="mt-2 text-2xl font-black">Tower-A / Rev 12</h2>
              <p className="mt-3 text-sm text-[#303030]">
                4 structural warnings, 2 compliance flags, 1 coordination conflict detected.
              </p>
              <div className="mt-5 grid grid-cols-3 gap-3 text-center text-xs font-bold">
                <div className="rounded-xl border-2 border-[#1b140f] bg-[#ffb566] p-2">Warnings 4</div>
                <div className="rounded-xl border-2 border-[#1b140f] bg-[#ffd8b0] p-2">Flags 2</div>
                <div className="rounded-xl border-2 border-[#1b140f] bg-[#fff3e4] p-2">Open 11</div>
              </div>
            </article>

            <article className="rotate-[1.2deg] rounded-3xl border-2 border-[#1b140f] bg-[#ff7a00] p-6 text-white shadow-[8px_8px_0_0_#1b140f]">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#fff0e0]">AI Insight</p>
              <p className="mt-3 text-lg font-semibold leading-7">
                Slab opening at Grid C7 may violate minimum clear edge distance per your selected
                code profile.
              </p>
              <p className="mt-4 text-sm text-[#fff0e0]">Suggested next step: inspect affected floor plan and compare alternatives.</p>
            </article>
          </div>
        </section>
      </div>

      <section className="mx-auto w-full max-w-7xl px-5 py-14 md:px-8" id="features">
        <div className="grid gap-5 md:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className="rounded-3xl border-2 border-[#1b140f] bg-white p-6 shadow-[4px_4px_0_0_#1b140f]"
            >
              <h3 className="text-2xl font-black leading-tight">{feature.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#2f2f2f]">{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y-2 border-[#1b140f] bg-[#ff7a00] py-12 text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-4 px-5 md:grid-cols-3 md:px-8">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-2xl border-2 border-white p-6">
              <p className="text-4xl font-black tracking-tight">{stat.value}</p>
              <p className="mt-2 text-sm uppercase tracking-[0.16em] text-[#fff1dd]">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 py-16 md:px-8" id="pricing">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-4xl font-black tracking-tight md:text-5xl">Simple Pricing, Serious Throughput</h2>
          <Link href="/dashboard" className="text-sm font-bold underline">
            Jump into dashboard
          </Link>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {plans.map((plan) => (
            <article
              key={plan.name}
              className="rounded-3xl border-2 border-[#1b140f] bg-white p-6 shadow-[5px_5px_0_0_#1b140f]"
            >
              <p className="font-mono text-xs uppercase tracking-[0.2em]">{plan.name}</p>
              <p className="mt-3 text-4xl font-black">{plan.price}</p>
              <p className="mt-1 text-sm text-[#3a3a3a]">for {plan.target}</p>
              <ul className="mt-5 space-y-2 text-sm">
                {plan.points.map((point) => (
                  <li key={point}>• {point}</li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className="mt-6 inline-flex rounded-full border-2 border-[#1b140f] bg-[#ff7a00] px-5 py-2 text-sm font-bold text-white"
              >
                Choose {plan.name}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-5 pb-20 md:px-8" id="faq">
        <div className="rounded-3xl border-2 border-[#1b140f] bg-[#fff1e2] p-7 md:p-10">
          <h2 className="text-3xl font-black tracking-tight md:text-4xl">FAQ</h2>
          <div className="mt-6 space-y-5 text-sm leading-6 md:text-base">
            <div>
              <h3 className="font-bold">Does Xenon support IFC-first workflows?</h3>
              <p>Yes. Upload IFC, classify elements, and review with AI checks and human annotations in one flow.</p>
            </div>
            <div>
              <h3 className="font-bold">Can I run pilot reviews with my team this week?</h3>
              <p>Yes. Start in minutes and share a dashboard link with your team to begin collaborative reviews.</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
