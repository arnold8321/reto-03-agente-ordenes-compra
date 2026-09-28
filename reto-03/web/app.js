const form = document.querySelector("#form");
const input = document.querySelector("#input");
const messages = document.querySelector("#messages");
const tools = document.querySelector("#tools");
const status = document.querySelector("#status");
let sessionId = localStorage.getItem("reto03-session") || "";

function addMessage(text, who = "assistant") {
  const div = document.createElement("div");
  div.className = `bubble ${who}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function renderTools(events) {
  if (!events.length) return;
  tools.innerHTML = "";
  for (const event of events) {
    const card = document.createElement("div");
    card.className = "tool";
    const title = document.createElement("strong");
    title.textContent = event.tool;
    const body = document.createElement("pre");
    body.textContent = JSON.stringify(event.result, null, 2);
    card.append(title, body);
    tools.appendChild(card);
  }
}

async function health() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();
    status.textContent = `${data.provider} · ${data.model}`;
    status.className = "status online";
  } catch {
    status.textContent = "Sin conexión";
  }
}

async function send(message) {
  addMessage(message, "user");
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  const data = await response.json();
  if (!data.ok) { addMessage(data.error || "Ocurrió un error."); return; }
  sessionId = data.sessionId;
  localStorage.setItem("reto03-session", sessionId);
  addMessage(data.reply);
  renderTools(data.toolCalls || []);
  if (data.needsConfirmation) input.placeholder = "Escribe: confirmo";
  else input.placeholder = "Ej.: Procesa SOL-004";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = input.value.trim();
  if (!value) return;
  input.value = "";
  try { await send(value); } catch (error) { addMessage(`Error de conexión: ${error.message}`); }
});

addMessage("Hola. Puedo procesar los seis casos del reto. Prueba con: Procesa SOL-001.");
health();
