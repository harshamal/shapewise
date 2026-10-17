import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { AiOnboarding } from "./ai-onboarding";

export const metadata: Metadata = { title: "Set up with AI" };

export default async function StartWithAi() {
  const session = await getSession().catch(() => null);
  if (!session) redirect("/sign-in?next=%2Fstart%2Fai" as never);
  return <AiOnboarding firstName={session.name?.split(/\s+/)[0]} />;
}
