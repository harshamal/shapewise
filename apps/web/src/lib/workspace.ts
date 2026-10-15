import { Blueprint, navigation } from "@shapewise/blueprint";
import { bakery, plasticsFactory } from "@shapewise/blueprint/fixtures";

const DEMOS = { demo: plasticsFactory, bakery } as const;

/**
 * Until Firestore is wired up, workspaces render demo blueprints ("demo" is the
 * plastics factory, "bakery" the bakery). This becomes a cached read of
 * tenants/{tid}/blueprints/{active}.
 */
export async function loadWorkspace(tenant: string) {
  const bp = Blueprint.parse(DEMOS[tenant as keyof typeof DEMOS] ?? plasticsFactory);
  return { bp, sections: navigation(bp), base: `/w/${tenant}` };
}
