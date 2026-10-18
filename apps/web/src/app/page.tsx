import Link from "next/link";
import { userWorkspaces } from "@shapewise/db";
import { adminDb } from "@/lib/auth/admin";
import { getSession } from "@/lib/auth/session";
import { ShapeParticleCanvas } from "@/components/shape-particle-canvas";
import { LandingFlow } from "@/components/landing-flow";
import { Logo } from "@/components/logo";

const primary =
  "inline-flex h-10 items-center justify-center rounded-sw bg-accent px-5 text-sm font-medium text-accent-ink transition-colors hover:bg-accent-hover shadow-xs";
const secondary =
  "inline-flex h-10 items-center justify-center rounded-sw bg-surface-sunken/80 px-5 text-sm font-medium text-ink transition-colors hover:bg-surface-sunken shadow-xs";

/** What's in the box today. Only screens that work. */
const MODULES = [
  { name: "Sales", items: "Quotes, sales orders, delivery notes, invoices, payments received, credit notes" },
  { name: "Purchases", items: "Vendors, purchase orders, goods received, bills, payments, expenses" },
  { name: "Inventory", items: "Items, warehouses, lots and expiry dates, adjustments, transfers" },
  { name: "Production", items: "Recipes, production orders, batches, incoming inspection, non conformance" },
  { name: "Point of sale", items: "POS sales and cashier shifts with a cash count at close" },
  { name: "Accounting", items: "Chart of accounts, journals, profit and loss, balance sheet, trial balance" },
  { name: "Tax", items: "VAT, GST, sales and withholding taxes, set up for your country" },
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
            <Link href={(workspaces.length ? "/workspaces" : "/start") as never} className="inline-flex h-8 items-center rounded-sw bg-accent px-3.5 text-[13px] font-medium text-accent-ink hover:bg-accent-hover shadow-xs">
              {workspaces.length ? "Your workspaces" : "Set up my business"}
            </Link>
          ) : (
            <div className="flex items-center gap-3">
              <Link href="/sign-in?next=%2Fworkspaces" className="text-sm text-ink-muted hover:text-ink transition-colors">
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
            <p className="max-w-2xl text-lg leading-relaxed text-pretty text-ink-muted">
              Tell Shapewise how your business runs, or hand it the spreadsheets you already keep. It builds your screens, roles, approvals and documents, then keeps your books and stock as you work.
            </p>

            {session && workspaces.length > 0 ? (
              <div className="flex flex-wrap items-center gap-3">
                <Link href={(workspaces.length === 1 ? `/w/${workspaces[0]!.id}` : "/workspaces") as never} className={primary}>
                  {workspaces.length === 1 ? `Open ${workspaces[0]!.name}` : "Go to my workspaces"}
                </Link>
                <Link href="/start" className={secondary}>
                  Set up another business
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
              <li>Taxes set up for your country</li>
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
              <p className="text-ink-muted">Four steps, start to finish, shown here with the demo bakery. No consultants and no setup forms.</p>
            </div>
            <LandingFlow />
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
