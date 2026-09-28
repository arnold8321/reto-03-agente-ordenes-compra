export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmAdapter {
  answer(messages: LlmMessage[]): Promise<string>;
}
