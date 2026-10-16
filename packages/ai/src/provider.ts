import { AzureOpenAi, azureConfigFromEnv } from "./azure";
import { Gemini, apiKeyFromEnv } from "./gemini";
import { LlmError, type Llm } from "./llm";

/**
 * The AI provider for this process. SW_AI_PROVIDER picks one explicitly
 * ("azure" or "gemini"); otherwise Azure OpenAI is used when its settings
 * are present, then Gemini. Switching is configuration only.
 */
export function createLlm(): Llm {
  const wanted = process.env.SW_AI_PROVIDER?.toLowerCase();
  const azure = azureConfigFromEnv();
  if ((wanted === "azure" || (!wanted && azure)) && azure) return new AzureOpenAi(azure);
  if ((wanted === "gemini" || !wanted) && apiKeyFromEnv()) return new Gemini();
  throw new LlmError("No AI provider is configured. Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY and AZURE_OPENAI_DEPLOYMENT, or GEMINI_API_KEY.", "config", false);
}
