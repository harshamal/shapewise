"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { NavSection } from "@shapewise/blueprint";
import { cx } from "@shapewise/ui";
import type { SettingsData } from "@/lib/settings-data";
import { AccountMenu } from "./account-menu";
import { AssistantPanel } from "./assistant-panel";
import { SettingsDialog } from "./settings-dialog";

/**
 * Workspace frame: a dark warm-grey rail (brand, sections → modules →
 * submodules from the blueprint) and a calm canvas with a slim top bar.
 */
export function WorkspaceShell({
  base,
  workspaceName,
  viewer,
  sections,
  settings,
  title,
  actions,
  children,
}: {
  /** /w/{tenant} */
  base: string;
  workspaceName: string;
  viewer: { name: string; role: string | null } | null;
  sections: NavSection[];
  settings: SettingsData;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  // The open settings section lives in the URL (?settings=extensions), so it can be linked to.
  const settingsTab = params.get("settings");

  const openSettings = useCallback(
    (tab?: string) => {
      const next = new URLSearchParams(params.toString());
      next.set("settings", tab ?? settingsTab ?? settings.tabs[0]?.key ?? "organisation");
      router.replace(`${pathname}?${next}` as never, { scroll: false });
    },
    [params, pathname, router, settings.tabs, settingsTab],
  );
  const closeSettings = useCallback(() => {
    const next = new URLSearchParams(params.toString());
    next.delete("settings");
    const q = next.toString();
    router.replace(`${pathname}${q ? `?${q}` : ""}` as never, { scroll: false });
  }, [params, pathname, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        openSettings();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAskOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings]);
  const [askOpen, setAskOpen] = useState(false);
  const tenant = base.split("/").pop() ?? "";

  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[var(--sw-rail-width)_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sw focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col bg-rail text-rail-ink md:flex" aria-label="Workspace">
        <div className="flex h-[var(--sw-topbar-height)] shrink-0 items-center gap-2.5 px-5">
          <Logo />
          <span className="font-medium">Shapewise</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
          {sections.map((section) => (
            <div key={section.key} className="mt-3">
              <p className="px-2 pb-1 text-[11px] text-rail-muted">{section.label}</p>
              <ul className="space-y-0.5">
                {/* A section holding one module (Governance, Settings) lists its pages directly. */}
                {section.modules.length === 1 && section.modules[0]!.submodules.length > 1
                  ? section.modules[0]!.submodules.map((s) => {
                      const href = `${base}/${section.modules[0]!.key}/${s.key}`;
                      return (
                        <li key={s.key}>
                          <NavLink href={href} active={pathname === href || pathname.startsWith(`${href}/`)}>
                            {s.label}
                          </NavLink>
                        </li>
                      );
                    })
                  : section.modules.map((m) => {
                      const href = `${base}/${m.key}`;
                      // Single-page modules (Overview, Reports) link straight to their page.
                      if (m.submodules.length === 1) {
                        const only = m.submodules[0]!;
                        const target = m.key === "overview" ? base : `${href}/${only.key}`;
                        const active = m.key === "overview" ? pathname === base : pathname.startsWith(href);
                        return (
                          <li key={m.key}>
                            <NavLink href={target} active={active}>
                              {m.label}
                            </NavLink>
                          </li>
                        );
                      }
                      return <ModuleGroup key={m.key} href={href} label={m.label} pathname={pathname} items={m.submodules.map((s) => ({ href: `${href}/${s.key}`, label: s.label }))} />;
                    })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-3 pt-2">
          <button
            type="button"
            onClick={() => openSettings()}
            aria-keyshortcuts="Control+Comma"
            className="flex h-8 w-full items-center gap-2 rounded-sw-sm px-2 text-sm text-rail-muted hover:bg-rail-active hover:text-rail-ink"
          >
            <GearIcon />
            Settings
            <kbd className="ml-auto text-[11px] text-rail-muted/70">Ctrl ,</kbd>
          </button>
        </div>
        <div className="space-y-1 px-5 py-3 text-sm">
          <p className="truncate text-rail-muted">{workspaceName}</p>
          <AccountMenu viewer={viewer} here={pathname} />
        </div>
      </aside>
      <AssistantPanel tenant={tenant} open={askOpen} onClose={() => setAskOpen(false)} />
      <SettingsDialog data={settings} open={settingsTab !== null} tab={settingsTab ?? ""} onTab={openSettings} onClose={closeSettings} />

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-[var(--sw-topbar-height)] items-center gap-4 border-b bg-canvas/90 px-4 backdrop-blur md:px-6">
          <h1 className="truncate text-[15px] font-medium">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            {actions}
            <button
              type="button"
              onClick={() => setAskOpen((o) => !o)}
              aria-expanded={askOpen}
              aria-keyshortcuts="Control+J"
              className="inline-flex h-8 items-center gap-1.5 rounded-sw border border-border-strong bg-surface px-3 text-[13px] font-medium hover:bg-surface-sunken"
            >
              Ask
              <kbd className="text-[11px] text-ink-faint">Ctrl J</kbd>
            </button>
          </div>
        </header>
        <main id="main" className="flex-1 px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function ModuleGroup({ href, label, items, pathname }: { href: string; label: string; items: { href: string; label: string }[]; pathname: string }) {
  const inside = pathname === href || pathname.startsWith(`${href}/`);
  const [open, setOpen] = useState(inside);
  const id = `nav-${href.replaceAll("/", "-")}`;
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex h-8 w-full items-center justify-between rounded-sw-sm px-2 text-left text-sm transition-colors hover:bg-rail-active hover:text-rail-ink",
          inside ? "text-rail-ink" : "text-rail-muted",
        )}
      >
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={cx("transition-transform", open && "rotate-90")}>
          <path d="M4.5 3 7.5 6l-3 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul id={id} className="mb-1 ml-2 space-y-0.5 border-l border-white/10 pl-2">
          {items.map((item) => (
            <li key={item.href}>
              <NavLink href={item.href} active={pathname === item.href || pathname.startsWith(`${item.href}/`)} small>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function NavLink({ href, active, small, children }: { href: string; active: boolean; small?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href as never}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center rounded-sw-sm px-2 transition-colors",
        small ? "h-7 text-[13px]" : "h-8 text-sm",
        active ? "bg-rail-active text-rail-ink" : "text-rail-muted hover:bg-rail-active hover:text-rail-ink",
      )}
    >
      {children}
    </Link>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  );
}

function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="5" fill="var(--sw-accent)" />
      <path d="M6 13.5c1.2 1 2.5 1.5 4 1.5 2 0 3.3-1 3.3-2.4 0-3.2-7-1.8-7-5.3C6.3 5.9 7.6 5 9.6 5c1.3 0 2.4.4 3.4 1.1" fill="none" stroke="var(--sw-accent-ink)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
