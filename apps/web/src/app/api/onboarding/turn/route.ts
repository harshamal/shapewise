import { NextResponse } from "next/server";
import { z } from "zod";
import { BusinessProfile, FACTS, OPENING, createLlm, interviewTurn, type InterviewPrompt, type Message } from "@shapewise/ai";
import { getSession } from "@/lib/auth/session";
import { Attachments, ndjson } from "@/lib/ndjson";

export const runtime = "nodejs";
export const maxDuration = 120;

const Text = z.string().max(6000);
const ChatMessage = z.union([
  z.object({ role: z.literal("user"), text: Text, attachments: Attachments }),
  z.object({ role: z.literal("assistant"), text: Text }),
]);
const Prompt = z.object({
  note: z.string().max(600),
  question: z.string().max(300),
  topic: z.string().max(40),
  section: z.string().max(40),
  topicLabel: z.string().max(60),
  input: z.object({ kind: z.enum(["text", "single", "multi", "confirm"]), options: z.array(z.string().max(60)).max(10), placeholder: z.string().max(120) }),
  fact: z.enum(FACTS).optional(),
  preselected: z.array(z.string().max(60)).max(10).optional(),
});
const Input = z.object({
  history: z.array(ChatMessage).max(80),
  profile: BusinessProfile,
  deferred: Prompt.optional(),
  message: z.string().trim().min(1).max(4000),
  attachments: Attachments,
  answering: z.enum(FACTS).optional(),
});

/**
 * One interview turn, streamed: `partial` events while the model writes its
 * note and question, then `done` with the new state. Fact questions come
 * back at once, with no model call.
 */
export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ message: "Please sign in first." }, { status: 401 });
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "That message couldn't be sent. Reload and try again." }, { status: 400 });
  const d = parsed.data;
  return ndjson(async (send) => {
    const history: Message[] = d.history.length ? (d.history as Message[]) : [{ role: "assistant", text: OPENING }];
    const r = await interviewTurn(
      createLlm(),
      { history, profile: d.profile, deferred: d.deferred as InterviewPrompt | undefined },
      { message: d.message, attachments: d.attachments, answering: d.answering },
      (p) => send({ t: "partial", ...p }),
    );
    send({ t: "done", history: r.history, profile: r.profile, deferred: r.deferred, prompt: r.prompt, ready: r.ready });
  }, request);
}
