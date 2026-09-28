import { serve } from "bun";
import { randomUUID } from "node:crypto";
import { processMessage, createAgent } from "./agent/service";

interface SessionMessage { role: "user" | "assistant"; content: string; ts: string; }
interface Session { id: string; messages: SessionMessage[]; pendingCase: string | null; }

const index = await Bun.file("web/index.html").text();
const appJs = await Bun.file("web/app.js").text();
const css = await Bun.file("web/style.css").text();
const agent = createAgent();
const sessions = new Map<string, Session>();

function sessionFor(id?: string): Session {
  const key = id || randomUUID();
  const existing = sessions.get(key);
  if (existing) return existing;
  const session: Session = { id: key, messages: [], pendingCase: null };
  sessions.set(key, session);
  return session;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*" } });
}

serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" } });
    if (req.method === "GET" && url.pathname === "/") return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
    if (req.method === "GET" && url.pathname === "/app.js") return new Response(appJs, { headers: { "content-type": "application/javascript; charset=utf-8" } });
    if (req.method === "GET" && url.pathname === "/style.css") return new Response(css, { headers: { "content-type": "text/css; charset=utf-8" } });
    if (req.method === "GET" && url.pathname === "/api/health") return json({ ok: true, provider: agent.provider, model: agent.model });

    if (req.method === "GET" && url.pathname.startsWith("/api/sessions/")) {
      const id = url.pathname.split("/").pop() ?? "";
      const session = sessions.get(id);
      return session ? json(session) : json({ ok: false, error: "Sesión no encontrada." }, 404);
    }

    if (req.method === "POST" && url.pathname === "/api/chat") {
      try {
        const body = await req.json() as { sessionId?: string; message?: string };
        if (!body.message?.trim()) return json({ ok: false, error: "El mensaje es obligatorio." }, 400);
        const session = sessionFor(body.sessionId);
        session.messages.push({ role: "user", content: body.message.trim(), ts: new Date().toISOString() });
        const result = await processMessage(body.message.trim(), session.pendingCase, agent.adapter);
        session.pendingCase = result.needsConfirmation ? result.caseId ?? null : null;
        session.messages.push({ role: "assistant", content: result.message, ts: new Date().toISOString() });
        return json({ ok: true, sessionId: session.id, reply: result.message, toolCalls: result.events, needsConfirmation: result.needsConfirmation, caseId: result.caseId });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
      }
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Reto 03 listo en http://localhost:${process.env.PORT ?? 3000}`);
console.log(`Proveedor LLM: ${agent.provider} | Modelo: ${agent.model}`);
