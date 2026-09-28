import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tools } from "./src/tools/oc";
import type { OrdenCompra, Paquete, Validacion } from "./src/types";

const casos = ["sol-001", "sol-002", "sol-003", "sol-004", "sol-005", "sol-006"];
const parse = (text: string): { ok: boolean; data?: unknown; error?: string } => JSON.parse(text) as { ok: boolean; data?: unknown; error?: string };

async function limpiarSalida(): Promise<void> {
  await rm(join(process.cwd(), "out", "control.csv"), { force: true });
  await rm(join(process.cwd(), "out", "log.jsonl"), { force: true });
  await rm(join(process.cwd(), "out", "sap"), { recursive: true, force: true });
  await rm(join(process.cwd(), "out", "sol-001"), { recursive: true, force: true });
  await rm(join(process.cwd(), "out", "sol-002"), { recursive: true, force: true });
  await rm(join(process.cwd(), "out", "sol-003"), { recursive: true, force: true });
  await rm(join(process.cwd(), "out", "sol-004"), { recursive: true, force: true });
  await rm(join(process.cwd(), "out", "sol-005"), { recursive: true, force: true });
  await rm(join(process.cwd(), "out", "sol-006"), { recursive: true, force: true });
}

async function verificarCaso(caso: string, confirmado = false): Promise<void> {
  const lectura = parse(await tools.oc_leer_paquete.execute({ caso }));
  if (!lectura.ok) { console.log(`${caso}: ERROR lectura - ${lectura.error}`); return; }
  const paquete = lectura.data as Paquete;

  const validacion = parse(await tools.oc_validar.execute({ caso, paquete }));
  if (!validacion.ok) { console.log(`${caso}: ERROR validación - ${validacion.error}`); return; }
  const resultado = validacion.data as Validacion;

  console.log(`\n${caso.toUpperCase()}`);
  console.log(`apta=${resultado.apta} bloqueos=${resultado.bloqueos.length} confirmaciones=${resultado.confirmaciones.length} retroactiva=${resultado.retroactiva}`);
  for (const bloqueo of resultado.bloqueos) console.log(`  BLOQUEO ${bloqueo.codigo}: ${bloqueo.motivo}`);
  for (const confirmacion of resultado.confirmaciones) console.log(`  CONFIRMACIÓN ${confirmacion.codigo}: ${confirmacion.motivo}`);

  if (resultado.bloqueos.length || (resultado.confirmaciones.length && !confirmado)) return;

  const payloadResult = parse(await tools.oc_construir_payload.execute({ caso, paquete, derivados: resultado.derivados }));
  if (!payloadResult.ok) { console.log(`  ERROR payload: ${payloadResult.error}`); return; }
  const payload = (payloadResult.data as { payload: OrdenCompra }).payload;
  if (resultado.retroactiva) payload.excepciones.push({ codigo: "RETROACTIVA", detalle: "Factura anterior a la solicitud; confirmada por el usuario en esta demo.", confirmado_por: "usuario" });

  const evidencia = parse(await tools.oc_generar_evidencia.execute({ caso }));
  if (!evidencia.ok) { console.log(`  ERROR evidencia: ${evidencia.error}`); return; }
  const creacion = parse(await tools.oc_crear.execute({ caso, payload, confirmado: true }));
  if (!creacion.ok) { console.log(`  ERROR creación: ${creacion.error}`); return; }
  const data = creacion.data as { numero_oc: string; idempotente: boolean };
  console.log(`  OC=${data.numero_oc} idempotente=${data.idempotente} evidencia=${(evidencia.data as { ruta: string }).ruta}`);
}

async function main(): Promise<void> {
  await limpiarSalida();
  console.log("DEMO RETO 03 - sin LLM");
  for (const caso of casos) await verificarCaso(caso);

  console.log("\nSOL-004 con confirmación explícita");
  await verificarCaso("sol-004", true);

  console.log("\nSOL-001 idempotencia");
  await verificarCaso("sol-001", true);
  await verificarCaso("sol-001", true);
  console.log("La segunda ejecución de SOL-001 debe conservar el mismo número de OC y marcar idempotente=true.");
}

main();
