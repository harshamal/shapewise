import { Blueprint } from "@shapewise/blueprint";
import { plasticsFactory } from "@shapewise/blueprint/fixtures";
import type { NavGroup } from "@/components/workspace-shell";

/**
 * Until Firestore is wired up, every workspace renders the demo plastics
 * blueprint. This becomes a cached read of tenants/{tid}/blueprints/{active}.
 */
export async function loadBlueprint(_tenant: string): Promise<Blueprint> {
  return Blueprint.parse(plasticsFactory);
}

/** Sidebar navigation derived from the blueprint's enabled modules and entities. */
export function navFor(tenant: string, bp: Blueprint): NavGroup[] {
  const base = `/w/${tenant}`;
  const modules = bp.modules.filter((m) => m.enabled).sort((a, b) => a.order - b.order);
  return [
    { items: [{ href: base, label: "Overview", exact: true }] },
    ...modules
      .map((m) => ({
        label: m.label,
        items: bp.entities
          .filter((e) => e.module === m.id)
          .map((e) => ({ href: `${base}/${e.key}`, label: e.labelPlural })),
      }))
      .filter((g) => g.items.length > 0),
  ];
}
