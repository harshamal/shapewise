/**
 * The parts of the AI package that are safe to bundle for the browser:
 * profile shapes, sections and display helpers. No provider code, no keys.
 */
export * from "./onboarding/profile";
export { FACTS, MAX_MESSAGE, TOPIC_LABEL, TOPIC_SECTION, OPENING_PROMPT, type Fact, type InterviewPrompt, type PartialPrompt, type AnswerInput } from "./onboarding/interview";
export type { Attachment, Message } from "./llm";
export { suggestReports, availableReports, PLACE_OPTIONS, type Suggestion } from "./onboarding/analytics";
