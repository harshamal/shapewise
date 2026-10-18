import "server-only";
import type { Blueprint } from "@shapewise/blueprint";
import { blueprintHistory, getChange, listChanges, loadBlueprintVersion, saveBlueprint, saveChange, updateChange, type ChangeDoc, type VersionInfo } from "@shapewise/db";
import { adminDb } from "./auth/admin";
import { isDemo, setDemoBlueprint } from "./workspace";

/**
 * Where change requests and setup versions live: Firestore for real
 * workspaces, memory for the demos (reset on restart).
 */

export interface ChangeStore {
  save(doc: Omit<ChangeDoc, "id">): Promise<string>;
  get(id: string): Promise<ChangeDoc | null>;
  update(id: string, patch: Partial<Omit<ChangeDoc, "id" | "body">>): Promise<void>;
  list(): Promise<Omit<ChangeDoc, "body">[]>;
  history(): Promise<VersionInfo[]>;
  version(v: number): Promise<Blueprint | null>;
  /** Saves `bp` (already at the next version number) as the live setup. */
  publish(bp: Blueprint, by: string, summary: string): Promise<void>;
}

interface DemoState {
  changes: ChangeDoc[];
  versions: { bp: Blueprint; info: VersionInfo }[];
}
const g = globalThis as typeof globalThis & { __swDemoChanges?: Map<string, DemoState> };
const demo = (g.__swDemoChanges ??= new Map<string, DemoState>());

export function changeStore(tenant: string, current: Blueprint): ChangeStore {
  if (isDemo(tenant)) {
    const state: DemoState = demo.get(tenant) ?? { changes: [], versions: [{ bp: current, info: { version: current.version, summary: "Demo setup", createdAt: new Date().toISOString(), createdBy: "system" } }] };
    demo.set(tenant, state);
    return {
      save: async (doc) => {
        const id = `chg${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        state.changes.unshift({ id, ...doc });
        return id;
      },
      get: async (id) => state.changes.find((c) => c.id === id) ?? null,
      update: async (id, patch) => {
        const c = state.changes.find((x) => x.id === id);
        if (c) Object.assign(c, patch);
      },
      list: async () => state.changes.slice(0, 30).map(({ body: _b, ...rest }) => rest),
      history: async () => state.versions.map((v) => v.info).sort((a, b) => b.version - a.version),
      version: async (v) => state.versions.find((x) => x.info.version === v)?.bp ?? null,
      publish: async (bp, by, summary) => {
        setDemoBlueprint(tenant, bp);
        state.versions.push({ bp, info: { version: bp.version, summary, createdAt: new Date().toISOString(), createdBy: by } });
      },
    };
  }
  const db = adminDb();
  return {
    save: (doc) => saveChange(db, tenant, doc),
    get: (id) => getChange(db, tenant, id),
    update: (id, patch) => updateChange(db, tenant, id, patch),
    list: () => listChanges(db, tenant),
    history: () => blueprintHistory(db, tenant),
    version: (v) => loadBlueprintVersion(db, tenant, v),
    publish: (bp, by, summary) => saveBlueprint(db, tenant, bp, by, summary),
  };
}
