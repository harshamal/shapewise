import { z } from "zod";
import type { Llm, Message } from "../llm";
import { BusinessProfile, mergeProfile, profileReady } from "./profile";

/**
 * One turn of the onboarding interview. The model replies to the person and
 * updates the business profile in the same structured answer; code merges
 * the profile and decides when there's enough to design.
 */
export const InterviewTurn = z.object({
  reply: z.string().min(1).max(800).describe("what to say next: acknowledge briefly, then ask one or two short questions"),
  profile: BusinessProfile.describe("everything learned so far, including from earlier turns"),
  enoughToDesign: z.boolean().describe("true when you could design a sensible first setup"),
});

const SYSTEM = `You set up business software for small and medium businesses in Sri Lanka by interviewing the owner.
Speak plainly and warmly, like a helpful consultant. No jargon (never say module, entity, schema, blueprint).
Ask about one topic at a time, at most two short questions per turn, and use what they already told you.
Cover, in a natural order: what they do and sell; who buys and how; whether they make things (steps, machines, quality checks);
stock (warehouses, lots, expiry); documents they use today; who will use the system; who approves what and above which amounts;
extra details they track; taxes (VAT, SSCL, WHT).
Never invent facts. Record only what they said in the profile, in their words. Six to ten turns is usually enough.
When you have enough, say you're ready to build their setup and ask if there's anything else first.`;

export interface InterviewState {
  history: Message[];
  profile: BusinessProfile;
}

export async function interviewTurn(llm: Llm, state: InterviewState, message: string): Promise<InterviewState & { reply: string; ready: boolean }> {
  const history: Message[] = [...state.history, { role: "user", text: message.slice(0, 4000) }];
  const { value } = await llm.json({
    tier: "chat",
    system: `${SYSTEM}\n\nProfile so far (JSON): ${JSON.stringify(state.profile)}`,
    messages: history,
    schema: InterviewTurn,
    temperature: 0.5,
  });
  const profile = mergeProfile(state.profile, value.profile);
  return {
    history: [...history, { role: "assistant", text: value.reply }],
    profile,
    reply: value.reply,
    // Code, not the model, has the final say on readiness.
    ready: value.enoughToDesign && profileReady(profile),
  };
}

export const OPENING = "Hi! I'll set up your system around how your business actually works. To start: what's the business called, and what do you make or sell?";
