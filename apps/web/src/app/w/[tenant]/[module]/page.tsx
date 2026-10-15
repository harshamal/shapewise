import { notFound, redirect } from "next/navigation";
import { findNav } from "@shapewise/blueprint";
import { loadWorkspace } from "@/lib/workspace";

/** A module on its own opens its first submodule. */
export default async function ModulePage({ params }: { params: Promise<{ tenant: string; module: string }> }) {
  const { tenant, module } = await params;
  const { sections, base } = await loadWorkspace(tenant);
  const found = findNav(sections, module);
  if (!found?.submodule) notFound();
  redirect(`${base}/${module}/${found.submodule.key}` as never);
}
