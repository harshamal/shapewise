import Link from "next/link";
import { userWorkspaces } from "@shapewise/db";
import { adminDb } from "@/lib/auth/admin";
import { getSession } from "@/lib/auth/session";
import { ShapeParticleCanvas } from "@/components/shape-particle-canvas";
import { Logo } from "@/components/logo";

const primary =
  "inline-flex h-10 items-center justify-center rounded-sw bg-accent px-5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover shadow-xs";
const secondary =
  "inline-flex h-10 items-center justify-center rounded-sw bg-surface-sunken/80 px-5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken shadow-xs";

/** How a business goes from nothing to running, in four steps, each with a small real example. */
const FLOW = [
  {
    step: "Talk",
    title: "Tell it how you work",
    body: "A short interview in plain words. Drop in price lists, stock sheets or old invoices and it reads them, so it only asks what it still needs.",
    example: (
      <div className="space-y-1.5 text-[13px]">
        <p className="w-fit max-w-[90%] rounded-xl rounded-bl-sm bg-surface px-3 py-1.5 shadow-xs">What do you make, and who buys it?</p>
        <p className="ml-auto w-fit max-w-[90%] rounded-xl rounded-br-sm bg-accent px-3 py-1.5 text-accent-ink shadow-xs">Bread and cakes. Our shop, plus three hotels on credit.</p>
      </div>
    ),
  },
  {
    step: "Check",
    title: "See the setup first",
    body: "Before anything is created you see the plan: the screens you'll use, who can do what, and which documents need approval.",
    example: (
      <div className="space-y-2 text-[13px]">
        <div className="flex flex-wrap gap-1">
          {["Sales", "Point of sale", "Production", "Inventory", "Banking"].map((m) => (
            <span key={m} className="rounded-full bg-surface-sunken px-2.5 py-0.5 text-xs">
              {m}
            </span>
          ))}
        </div>
        <p className="text-ink-muted">Purchase orders over Rs 10,000 wait for the owner.</p>
      </div>
    ),
  },
  {
    step: "Run",
    title: "Work, and the books keep themselves",
    body: "Quote, order, deliver, invoice, get paid. Each posted document moves stock and writes the double entry for you.",
    example: (
      <div className="space-y-2 text-[13px]">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {["Quote", "Order", "Delivery", "Invoice", "Payment"].map((d, i) => (
            <span key={d} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-faint">→</span>}
              <span className={d === "Invoice" ? "font-medium text-accent" : ""}>{d}</span>
            </span>
          ))}
        </p>
        <p className="font-mono text-xs text-ink-muted">Dr Receivables · Cr Sales · Cr VAT</p>
      </div>
    ),
  },
  {
    step: "Change",
    title: "Change it by asking",
    body: "Need a new field, register or rule? Describe it. You see exactly what changes, approve it, and can undo it later.",
    example: (
      <div className="space-y-1.5 text-[13px]">
        <p className="rounded-lg bg-surface px-2.5 py-1.5 text-ink-muted shadow-xs">“Add a seal number to delivery notes”</p>
        <p className="flex items-start gap-1.5">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
          Adds <span className="font-medium">Seal number</span> to delivery notes
        </p>
      </div>
    ),
  },
];

/** What's in the box today. Only screens that work. */
const MODULES = [
  { name: "Sales", items: "Quotes, sales orders, delivery notes, invoices, payments received, credit notes" },
  { name: "Purchases", items: "Vendors, purchase orders, goods received, bills, payments, expenses" },
  { name: "Inventory", items: "Items, warehouses, lots and expiry dates, adjustments, transfers" },
  { name: "Production", items: "Recipes, production orders, batches, incoming inspection, non conformance" },
  { name: "Point of sale", items: "POS sales and cashier shifts with a cash count at close" },
  { name: "Accounting", items: "Chart of accounts, journals, profit and loss, balance sheet, trial balance" },
  { name: "Tax", items: "VAT, SSCL and WHT for Sri Lanka, or your own country's taxes" },
  { name: "Control", items: "Roles and permissions, approvals by amount, audit log, setup history" },
];

const DETAILS = [
  { title: "Send on WhatsApp", body: "Invoices, quotes and delivery notes as PDFs, with a link your customer opens on their phone." },
  { title: "Ask your numbers", body: "“Who were my top customers this month?” The assistant answers from your records." },
  { title: "Staff, invited by link", body: "Each role sees only its own screens. A storekeeper never sees the bank." },
  { title: "Nothing is lost", body: "Every setup change is a new version you can go back to, and every action is logged." },
];

export default async function Home() {
  const session = await getSession().catch(() => null);
  const workspaces = session ? await userWorkspaces(adminDb(), session.uid).catch(() => []) : [];
  const home = workspaces[0] ? `/w/${workspaces[0].id}` : "/start";

  return (
    <div className="relative min-h-dvh bg-canvas text-ink selection:bg-accent-soft overflow-x-hidden">
      {/* Ambient particle animation running throughout the entire landing page */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 h-full w-full overflow-hidden select-none"
        aria-hidden="true"
      >
        <ShapeParticleCanvas caption={false} className="h-full w-full opacity-45" />
      </div>

      {/* Borderless Top Navigation */}
      <header className="sticky top-0 z-40 bg-canvas/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={22} />
            <span className="text-[15px] font-medium tracking-tight">Shapewise</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-ink-muted md:flex">
            <a href="#how" className="hover:text-ink transition-colors">
              How it works
            </a>
            <a href="#inside" className="hover:text-ink transition-colors">
              What's inside
            </a>
            <a href="#demo" className="hover:text-ink transition-colors">
              Demo
            </a>
          </nav>
          {session ? (
            <Link href={home as never} className="inline-flex h-8 items-center rounded-sw bg-accent px-3.5 text-[13px] font-medium text-accent-ink hover:bg-accent-hover shadow-xs">
              Open workspace
            </Link>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/sign-in?next=%2Fstart" className="text-sm text-ink-muted hover:text-ink transition-colors">
                Sign in
              </Link>
              <Link href="/sign-in?mode=signup&next=%2Fstart" className="inline-flex h-8 items-center rounded-sw bg-accent px-3.5 text-[13px] font-medium text-accent-ink hover:bg-accent-hover shadow-xs">
                Get started
              </Link>
            </div>
          )}
        </div>
      </header>

      <main>
        {/* Borderless Hero Section */}
        <section className="mx-auto grid max-w-7xl items-center gap-8 px-4 pt-12 pb-16 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:pb-24">
          <div className="space-y-6">
            <p className="font-mono text-xs tracking-wider text-accent uppercase">Business software for growing SMEs</p>
            <h1 className="text-4xl leading-[1.08] font-normal tracking-tight text-balance sm:text-5xl lg:text-[3.4rem]">
              The ERP that sets itself up from a conversation.
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-ink-muted">
              Tell Shapewise how your business runs, or hand it the spreadsheets you already keep. It builds your screens, roles, approvals and documents, then keeps your books and stock as you work.
            </p>

            {session && workspaces.length > 0 ? (
              <div className="max-w-md space-y-3">
                <ul className="divide-y divide-surface-sunken rounded-2xl bg-surface/85 p-1 shadow-xs backdrop-blur-xs">
                  {workspaces.map((w) => (
                    <li key={w.id}>
                      <Link href={`/w/${w.id}` as never} className="flex items-center justify-between px-4 py-3 rounded-xl transition-colors hover:bg-surface-sunken">
                        <span className="font-medium">{w.name}</span>
                        <span className="text-xs text-ink-muted capitalize">{w.roleKey.replaceAll("_", " ")}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link href="/start" className="inline-block text-sm text-accent hover:underline">
                  Set up another business →
                </Link>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Link href={session ? "/start" : "/sign-in?next=%2Fstart"} className={primary}>
                  Set up my business
                </Link>
                <Link href="/w/demo" className={secondary}>
                  Look around a demo
                </Link>
              </div>
            )}

            <ul className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-[13px] text-ink-muted">
              <li>No setup forms to fill in</li>
              <li>Sri Lankan VAT, SSCL and WHT ready</li>
              <li>Demos open without signing up</li>
            </ul>
          </div>

          {/* Hero Focal Particle Stage with Shape Captions */}
          <ShapeParticleCanvas className="mx-auto aspect-square w-full max-w-[30rem] pb-6" />
        </section>

        {/* Seamless Flow: How it works (No borders) */}
        <section id="how" className="py-16 sm:py-24">
          <div className="mx-auto max-w-7xl space-y-10 px-4 sm:px-6">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl font-normal tracking-tight text-balance sm:text-3xl">From a conversation to a running business</h2>
              <p className="text-ink-muted">The whole flow, start to finish. No consultants, no setup forms.</p>
            </div>
            <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {FLOW.map((f, i) => (
                <li key={f.step} className="flex flex-col gap-4 rounded-2xl bg-surface/80 p-6 shadow-xs backdrop-blur-xs transition-shadow hover:shadow-sm">
                  <p className="flex items-center gap-2 font-mono text-xs text-ink-muted">
                    <span className="grid size-5 place-items-center rounded-full bg-accent-soft text-[11px] text-accent">{i + 1}</span>
                    {f.step.toUpperCase()}
                  </p>
                  <div className="space-y-1.5">
                    <h3 className="font-medium text-ink">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-ink-muted">{f.body}</p>
                  </div>
                  <div className="mt-auto rounded-xl bg-surface-sunken/60 p-3.5">{f.example}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Seamless Flow: What's inside (No borders) */}
        <section id="inside" className="py-16 sm:py-24">
          <div className="mx-auto max-w-7xl space-y-12 px-4 sm:px-6">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl font-normal tracking-tight text-balance sm:text-3xl">Everything a trading or making business needs</h2>
              <p className="text-ink-muted">You only see the parts you use. A bakery and a plastics factory get very different systems from the same box.</p>
            </div>
            <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
              {MODULES.map((m) => (
                <div key={m.name} className="pt-2">
                  <dt className="text-sm font-medium text-ink">{m.name}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-ink-muted">{m.items}</dd>
                </div>
              ))}
            </dl>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {DETAILS.map((d) => (
                <div key={d.title} className="rounded-2xl bg-surface-sunken/70 p-5 shadow-xs">
                  <h3 className="text-sm font-medium text-ink">{d.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-muted">{d.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Seamless Flow: Demo (No borders) */}
        <section id="demo" className="py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr] lg:items-center">
              <div className="space-y-3">
                <h2 className="text-2xl font-normal tracking-tight text-balance sm:text-3xl">Try one before you build yours</h2>
                <p className="text-ink-muted">Two working businesses with months of sample trading. Post an invoice, approve an order, ask the assistant a question. Nothing you do there is kept.</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { href: "/w/demo", name: "Demo Plastics", what: "Injection moulding and printed containers", has: "Recipes, machines, batches, QC holds, customer orders" },
                  { href: "/w/bakery", name: "Demo Bakery", what: "Bread and cakes for a shop and hotels", has: "Daily production, lots with expiry, shop sales, credit customers" },
                ].map((d) => (
                  <Link key={d.href} href={d.href as never} className="group flex flex-col gap-3 rounded-2xl bg-surface/85 p-6 shadow-xs backdrop-blur-xs transition-shadow hover:shadow-md">
                    <div>
                      <p className="font-medium text-ink">{d.name}</p>
                      <p className="text-sm text-ink-muted">{d.what}</p>
                    </div>
                    <p className="text-[13px] text-ink-faint">{d.has}</p>
                    <span className="mt-auto text-sm text-accent group-hover:underline">Open the demo →</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Seamless Flow: Footer (No borders) */}
      <footer className="py-12 text-xs text-ink-muted">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6">
          <span className="flex items-center gap-2">
            <Logo size={16} />
            <span className="text-ink">Shapewise</span> by SYNCONIC (Pvt) Ltd
          </span>
          <span>Built for the Google AI Builder Cup 2026</span>
        </div>
      </footer>
    </div>
  );
}
