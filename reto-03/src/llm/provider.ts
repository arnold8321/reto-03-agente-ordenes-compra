import type { LlmAdapter, LlmMessage } from "./adapter";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

export class OpenAICompatibleAdapter implements LlmAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor() {
    this.apiKey = process.env.LLM_API_KEY ?? "";
    this.model = process.env.LLM_MODEL ?? "gpt-4o-mini";
    this.endpoint = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1/chat/completions";
    this.timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 20000);
  }

  get configured(): boolean { return Boolean(this.apiKey); }
  get modelName(): string { return this.model; }

  async answer(messages: LlmMessage[]): Promise<string> {
    if (!this.apiKey) throw new Error("LLM_API_KEY no está configurada.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages, temperature: 0.1, max_tokens: Number(process.env.LLM_MAX_TOKENS ?? 900) }),
        signal: controller.signal,
      });
      const data = await response.json() as ChatResponse;
      if (!response.ok) throw new Error(data.error?.message ?? `Proveedor LLM respondió HTTP ${response.status}.`);
      return data.choices?.[0]?.message?.content?.trim() ?? "No recibí una respuesta textual del modelo.";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Tiempo de espera agotado al consultar el modelo.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
