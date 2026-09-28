import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tools } from "../tools/oc";
import type { LlmAdapter, LlmMessage } from "../llm/adapter";
import { OpenAICompatibleAdapter } from "../llm/provider";
import { MockLlmAdapter } from "../llm/mock";
import type { OrdenCompra, Paquete, Validacion } from "../types";

export interface ToolEvent { tool: string; args: unknown; result: unknown; }
export interface AgentResult { message: string; events: ToolEvent[]; needsConfirmation: boolean; caseId?: string; provider: string; model: string; }

function parse(text: string): { ok: boolean; data?: unknown; error?: string } { return JSON.parse(text) as { ok: boolean; data?: unknown; error?: string }; }
function caseFromMessage(message: string): string | null { return message.match(/sol-\d{3}/i)?.[0].toLowerCase() ?? null; }
function isConfirmation(message: string): boolean { return /^(si|sí|confirmo|confirmar|ok|acepto|adelante)$/i.test(message.trim()); }

async function executeCase(caso: string, confirmed: boolean): Promise<{ message: string; events: ToolEvent[]; needsConfirmation: boolean }> {
  const events: ToolEvent[] = [];
  const read = parse(await tools.oc_leer_paquete.execute({ caso }));
  events.push({ tool: "oc_leer_paquete", args: { caso }, result: read });
  if (!read.ok) return { message: `No pude leer el paquete: ${read.error}`, events, needsConfirmation: false };
  const paquete = read.data as Paquete;

  const validation = parse(await tools.oc_validar.execute({ caso, paquete }));
  events.push({ tool: "oc_validar", args: { caso }, result: validation });
  if (!validation.ok) return { message: `La validación falló: ${validation.error}`, events, needsConfirmation: false };
  const v = validation.data as Validacion;

  if (v.bloqueos.length) {
    const details = v.bloqueos.map((b) => `• ${b.codigo}: ${b.motivo}\n  Acción: ${b.accion_sugerida}`).join("\n");
    return { message: `La solicitud ${caso.toUpperCase()} está bloqueada.\n\n${details}\n\nNo se creó ninguna OC.`, events, needsConfirmation: false };
  }

  if (v.confirmaciones.length && !confirmed) {
    const details = v.confirmaciones.map((c) => `• ${c.codigo}: ${c.motivo} ${JSON.stringify(c.datos)}`).join("\n");
    return { message: `La solicitud ${caso.toUpperCase()} requiere confirmación humana antes de crear la OC:\n\n${details}\n\n¿Confirmas que continúe?`, events, needsConfirmation: true };
  }

  const payloadResult = parse(await tools.oc_construir_payload.execute({ caso, paquete, derivados: v.derivados }));
  events.push({ tool: "oc_construir_payload", args: { caso, derivados: v.derivados }, result: payloadResult });
  if (!payloadResult.ok) return { message: `No pude construir el payload: ${payloadResult.error}`, events, needsConfirmation: false };
  const payload = payloadResult.data as { payload: OrdenCompra; trace: string };
  if (v.retroactiva) payload.payload.excepciones.push({ codigo: "RETROACTIVA", detalle: "Factura anterior a la solicitud; creación autorizada mediante confirmación humana.", confirmado_por: "usuario" });

  const evidence = parse(await tools.oc_generar_evidencia.execute({ caso }));
  events.push({ tool: "oc_generar_evidencia", args: { caso }, result: evidence });
  if (!evidence.ok) return { message: `No pude generar la evidencia: ${evidence.error}`, events, needsConfirmation: false };
  if (v.retroactiva && !payload.payload.excepciones.some((e) => e.codigo === "RETROACTIVA")) payload.payload.excepciones.push({ codigo: "RETROACTIVA", detalle: "OC retroactiva confirmada.", confirmado_por: "usuario" });

  const created = parse(await tools.oc_crear.execute({ caso, payload: payload.payload, confirmado: true }));
  events.push({ tool: "oc_crear", args: { caso, confirmado: true }, result: created });
  if (!created.ok) return { message: `No pude crear la OC: ${created.error}`, events, needsConfirmation: false };
  const data = created.data as { numero_oc: string; fecha: string; idempotente: boolean };
  return { message: `Proceso terminado para ${caso.toUpperCase()}.\n\nOC: ${data.numero_oc}\nEstado: ${data.idempotente ? "ya existía (idempotente)" : "creada en SAP simulado"}\nEvidencia: out/${caso}/aprobacion.pdf`, events, needsConfirmation: false };
}

async function llmReply(adapter: LlmAdapter, userMessage: string, deterministic: string, events: ToolEvent[]): Promise<string> {
  const system = await readFile(join(process.cwd(), "agent", "prompt.md"), "utf8");
  const evidence = JSON.stringify({ deterministic, tools: events }, null, 2);
  const messages: LlmMessage[] = [
    { role: "system", content: `${system}\n\nRegla adicional: las herramientas ya ejecutaron las validaciones. No inventes ni modifiques datos. Usa únicamente el resultado suministrado a continuación y responde en español claro.\n\nRESULTADO DE HERRAMIENTAS:\n${evidence}` },
    { role: "user", content: userMessage },
  ];
  return adapter.answer(messages);
}

export function createAgent(): { adapter: LlmAdapter; provider: string; model: string } {
  const openai = new OpenAICompatibleAdapter();
  if (openai.configured) return { adapter: openai, provider: "openai-compatible", model: openai.modelName };
  return { adapter: new MockLlmAdapter(), provider: "mock", model: "local-fallback" };
}

export async function processMessage(message: string, pendingCase: string | null, adapter: LlmAdapter): Promise<AgentResult> {
  const confirmation = pendingCase && isConfirmation(message);
  const caso = confirmation ? pendingCase : caseFromMessage(message);
  if (!caso) return { message: "Puedo procesar los casos del reto. Escribe, por ejemplo, “Procesa SOL-004”.", events: [], needsConfirmation: false, provider: "", model: "" };
  const result = await executeCase(caso, Boolean(confirmation));
  const messageText = result.message;
  return { ...result, message: messageText, caseId: caso, provider: "", model: "" };
}

export { caseFromMessage, isConfirmation };
