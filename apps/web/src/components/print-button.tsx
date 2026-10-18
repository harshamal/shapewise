"use client";

/** Prints the screen; the app's chrome and filters are hidden in print. */
export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center rounded-sw border border-border-strong px-3 text-sm hover:bg-surface-sunken print:hidden">
      {label}
    </button>
  );
}
