# Reto técnico 03 — Agente conversacional Órdenes de Compra SAP

Solución en TypeScript para el reto de Periferia IT Group. El backend usa **Bun** y las herramientas usan **Zod**. La aplicación incluye un frontend de chat, ciclo de agente protegido por reglas determinísticas, conexión opcional a un LLM mediante variable de entorno y un SAP simulado basado en archivos.

## 1. Qué hace

El agente recibe mensajes como `Procesa SOL-004`, lee el paquete del caso, valida RC1–RC10 contra los maestros, muestra las llamadas a herramientas, solicita confirmación cuando corresponde y crea la OC en el SAP simulado solo cuando los controles lo permiten.

La lógica crítica no depende de que el modelo "adivine" un valor: las herramientas determinísticas son la fuente de verdad para controles, montos, derivados, confirmaciones e idempotencia.

## 2. Requisitos

- Bun instalado.
- Para el modo conversacional con LLM: una clave del proveedor elegido en `LLM_API_KEY`.
- No se requiere clave para ejecutar `demo.ts`.

## 3. Instalación y ejecución local

```bash
bun install
bun run dev
```

Abrir `http://localhost:3000`.

## 4. Variables de entorno

Copiar `.env.example` a `.env` y configurar, como mínimo, `LLM_API_KEY` para habilitar el modelo. La clave se lee solo en backend y no se incluye en el repositorio.

```text
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1/chat/completions
```

Si no hay clave, la aplicación conserva el flujo determinístico y muestra el resultado de las herramientas con un fallback local.

## 5. Demo sin modelo

```bash
bun run demo
```

`demo.ts` procesa SOL-001 a SOL-006 directamente mediante las herramientas. También demuestra la confirmación de SOL-004 y la idempotencia de SOL-001. Limpia los artefactos generados de la ejecución anterior para que el resultado sea reproducible salvo timestamps.

## 6. API

- `POST /api/chat` — `{ sessionId?, message }` → `{ sessionId, reply, toolCalls, needsConfirmation }`.
- `GET /api/sessions/:id` — historial de la sesión.
- `GET /api/health` — estado del servicio y proveedor/modelo, sin exponer claves.

## 7. Casos

- SOL-001: creación automática.
- SOL-002: bloqueo por proveedor no registrado.
- SOL-003: bloqueo por aprobación/autorización.
- SOL-004: confirmación por diferencia de cotización.
- SOL-005: confirmación por operación retroactiva.
- SOL-006: confirmación por IVA faltante; condiciones de pago derivadas e informadas.

## 8. Estructura

```text
agent/prompt.md             # comportamiento del agente
src/agent/                  # orquestación y conversación
src/tools/oc.ts             # herramientas Zod y reglas de negocio
src/llm/                    # interfaz + proveedor compatible
src/sap/                    # interfaz + SAP simulado
src/knowledge/              # conocimiento funcional
web/                        # frontend
fixtures/                   # casos y maestros
out/                        # trazabilidad generada en ejecución
demo.ts                    # verificación determinística
SOLUCION.md                 # documentación técnica
```

## 9. Despliegue

La aplicación está preparada para un servicio Bun que exponga `PORT`. En el proveedor de despliegue se configuran `LLM_API_KEY`, `LLM_MODEL` y, si aplica, `LLM_BASE_URL` como secretos/variables de entorno. No se debe subir `.env` ni `node_modules/`.

**URL pública de prueba:** completar con la URL del servicio desplegado antes de la defensa.

## 10. Uso de IA en la construcción

La solución fue construida con asistencia de ChatGPT. La IA se utilizó para apoyar diseño, implementación, revisión de reglas y documentación; las reglas críticas se implementaron de forma determinística en las herramientas.

### Opción de despliegue con Docker

El repositorio incluye `Dockerfile` para servicios que soporten contenedores. El proceso de despliegue debe configurar `PORT` (si el proveedor lo requiere) y los secretos `LLM_API_KEY`, `LLM_MODEL` y `LLM_BASE_URL` desde el panel del proveedor, nunca dentro del código.
