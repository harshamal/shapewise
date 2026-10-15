"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@shapewise/ui";

export interface NavItem {
  href: string;
  label: string;
  /** Only active on an exact match (e.g. the workspace overview). */
  exact?: boolean;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

/**
 * Workspace frame: a dark warm-grey rail (brand, navigation from the blueprint's
 * modules, workspace name) and a calm canvas with a slim top bar.
 */
export function WorkspaceShell({
  workspaceName,
  nav,
  title,
  actions,
  children,
}: {
  workspaceName: string;
  nav: NavGroup[];
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[var(--sw-rail-width)_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-sw focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>

      <aside className="hidden flex-col bg-rail text-rail-ink md:flex" aria-label="Workspace">
        <div className="flex h-[var(--sw-topbar-height)] items-center gap-2.5 px-5">
          <Logo />
          <span className="font-medium">Shapewise</span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-2" aria-label="Main">
          {nav.map((group, gi) => (
            <div key={group.label ?? gi} className="mb-4">
              {group.label && <p className="px-2 pb-1.5 text-xs text-rail-muted">{group.label}</p>}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || (!item.exact && pathname.startsWith(`${item.href}/`));
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href as never}
                        aria-current={active ? "page" : undefined}
                        className={cx(
                          "flex h-8 items-center rounded-sw-sm px-2 text-sm transition-colors",
                          active ? "bg-rail-active text-rail-ink" : "text-rail-muted hover:bg-rail-active hover:text-rail-ink",
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-5 py-3 text-sm text-rail-muted">{workspaceName}</div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-10 flex h-[var(--sw-topbar-height)] items-center gap-4 border-b bg-canvas/90 px-4 backdrop-blur md:px-6">
          <h1 className="truncate text-[15px] font-medium">{title}</h1>
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        </header>
        <main id="main" className="flex-1 px-4 py-6 md:px-6">
          {children}
        </main>
      </div>
    </div>
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
