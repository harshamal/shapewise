/**
 * Workspace addresses (/w/{id}). Pure, so the sign-up form can use them in the browser.
 */

/** Lowercase letters, digits and dashes. */
export const WORKSPACE_ID = /^[a-z0-9][a-z0-9-]{2,29}$/;
const RESERVED = new Set(["demo", "bakery", "admin", "api", "app", "www", "new", "start", "sign-in", "settings", "help", "shapewise", "test"]);

/** Why an address can't be used, or null if it can. */
export function workspaceIdProblem(id: string): string | null {
  if (!WORKSPACE_ID.test(id)) return "Use 3 to 30 lowercase letters, numbers or dashes, starting with a letter or number.";
  if (RESERVED.has(id)) return "That address is reserved.";
  return null;
}

/** "Perera & Sons (Pvt) Ltd" → "perera-sons". */
export function suggestWorkspaceId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\((pvt|private)\)|\b(ltd|limited|pvt|plc|inc|llc)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : `${slug || "my"}-workspace`;
}
