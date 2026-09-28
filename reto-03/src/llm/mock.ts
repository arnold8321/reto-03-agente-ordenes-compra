import type { LlmAdapter, LlmMessage } from "./adapter";

export class MockLlmAdapter implements LlmAdapter {
  async answer(messages: LlmMessage[]): Promise<string> {
    const last = messages.at(-1)?.content ?? "";
    return `Modo local sin modelo. ${last}`;
  }
}
