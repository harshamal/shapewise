import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <p className="text-sm text-ink-muted">Shapewise</p>
      <h1 className="text-4xl leading-tight tracking-tight text-balance">
        Business software that takes the shape of your factory.
      </h1>
      <p className="max-w-xl text-lg text-ink-muted text-pretty">
        Describe how your business runs, or show us your spreadsheets. Shapewise builds the system around you, and
        changes with you when you ask in plain words.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/w/demo"
          className="inline-flex h-10 items-center rounded-sw bg-accent px-5 text-sm font-medium text-accent-ink hover:bg-accent-hover"
        >
          Open the demo workspace
        </Link>
      </div>
    </main>
  );
}
