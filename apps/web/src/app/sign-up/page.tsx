import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Create your account",
};

export default async function SignUp({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const q = new URLSearchParams({ mode: "signup" });
  if (next) q.set("next", next);
  redirect(`/sign-in?${q.toString()}` as never);
}
