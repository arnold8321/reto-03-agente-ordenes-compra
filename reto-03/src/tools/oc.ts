import { z } from "zod";
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { casePath, masterPath, readJson, readText } from "../data";
import type {
  Aprobacion, Correo, Cotizacion, Factura, OrdenCompra, Paquete, Solicitud, Validacion,
} from "../types";
import { MockSapAdapter } from "../sap/mock";

const caso = z.string().regex(/^sol-\d{3}$/, "caso debe tener formato sol-001").describe("Carpeta del caso, por ejemplo sol-001");
const paqueteSchema = z.object({
  correo: z.object({ id: z.string(), de: z.string(), asunto: z.string(), fecha: z.string(), adjuntos: z.array(z.string()) }),
  solicitud: z.object({
    solicitud_id: z.string(), solicitante: z.string(), proveedor_nombre: z.string(), proveedor_nit: z.string().optional(),
    descripcion: z.string(), centro_costo: z.string(), subarea: z.string(), cantidad: z.number(),
    valor_unitario: z.number(), valor_total: z.number(), moneda: z.enum(["COP", "USD"]),
    indicador_iva: z.string().optional(), condiciones_pago: z.string().optional(), fecha_solicitud: z.string(),
  }),
  cotizacion: z.object({
    numero: z.string(), fecha: z.string(), proveedor_nombre: z.string(), proveedor_nit: z.string().optional(),
    cantidad: z.number(), valor_unitario: z.number(), total: z.number(), iva_porcentaje: z.number().optional(), texto: z.string(),
  }).nullable(),
  aprobacion: z.object({ de: z.string(), para: z.string(), fecha: z.string(), asunto: z.string(), cuerpo: z.string() }).nullable(),
  factura: z.object({ numero: z.string(), fecha: z.string(), proveedor_nombre: z.string(), proveedor_nit: z.string().optional(), total: z.number() }).nullable(),
});
const derivadosSchema = z.record(z.unknown());

export const toolSchemas = {
  oc_leer_paquete: z.object({ caso }),
  oc_validar: z.object({ caso, paquete: paqueteSchema }),
  oc_construir_payload: z.object({ caso, paquete: paqueteSchema, derivados: derivadosSchema }),
  oc_generar_evidencia: z.object({ caso }),
  oc_crear: z.object({ caso, payload: z.unknown(), confirmado: z.boolean().optional() }),
};

function ok(data: unknown): string { return JSON.stringify({ ok: true, data }); }
function fail(error: unknown): string { return JSON.stringify({ ok: false, error: String(error) }); }
function money(n: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}
function sha256(value: string): string { return createHash("sha256").update(value).digest("hex"); }

interface Proveedor { codigo_sap: string; nit: string; nombre: string; condiciones_pago_default: string; indicador_iva_default: string; activo: boolean; }
interface Centro { centro_costo: string; nombre: string; subareas: string[]; aprobadores: Array<{ email: string; nombre: string; tope: number }>; }

function parseQuote(texto: string): Cotizacion {
  const lines = texto.split(/\r?\n/).map((line) => line.trim());
  const find = (prefix: string) => lines.find((line) => line.startsWith(prefix)) ?? "";
  const item = lines.find((line) => line.startsWith("1. ")) ?? "";
  const unit = Number((item.match(/Precio unitario[^:]*:\s*COP\s*([\d.]+)/)?.[1] ?? "0").replace(/\./g, ""));
  const total = Number((find("TOTAL (IVA incluido):").match(/COP\s*([\d.]+)/)?.[1] ?? "0").replace(/\./g, ""));
  return {
    numero: find("COTIZACIÓN").replace("COTIZACIÓN ", "").trim(),
    fecha: find("Fecha:").replace("Fecha:", "").trim(),
    proveedor_nombre: find("Proveedor:").replace("Proveedor:", "").trim(),
    proveedor_nit: find("NIT:").replace("NIT:", "").replace(/\D/g, ""),
    cantidad: Number(item.match(/Cantidad:\s*(\d+)/)?.[1] ?? 0),
    valor_unitario: unit,
    total,
    iva_porcentaje: Number(find("IVA ").match(/IVA\s*(\d+)%/)?.[1] ?? 0) || undefined,
    texto,
  };
}

function parseFactura(texto: string): Factura {
  const lines = texto.split(/\r?\n/).map((line) => line.trim());
  const vendedor = lines.find((line) => line.startsWith("Vendedor:")) ?? "";
  return {
    numero: lines[0]?.replace("FACTURA ELECTRÓNICA DE VENTA No. ", "") ?? "",
    fecha: lines.find((line) => line.startsWith("Fecha de emisión:"))?.replace("Fecha de emisión:", "").trim() ?? "",
    proveedor_nombre: vendedor.replace("Vendedor:", "").replace(/-\s*NIT.*$/, "").trim(),
    proveedor_nit: vendedor.match(/NIT\s*([\d.-]+)/)?.[1]?.replace(/\D/g, "") ?? "",
    total: Number((lines.find((line) => line.startsWith("TOTAL:"))?.match(/COP\s*([\d.]+)/)?.[1] ?? "0").replace(/\./g, "")),
  };
}

async function loadMasters(): Promise<{ proveedores: Proveedor[]; centros: Centro[] }> {
  const [proveedores, centros] = await Promise.all([
    readJson<Proveedor[]>(masterPath("proveedores.json")),
    readJson<Centro[]>(masterPath("centros-costo.json")),
  ]);
  return { proveedores, centros };
}

async function appendControl(casoId: string, solicitudId: string, resultado: string, numeroOc: string, retroactiva: boolean, bloqueos: string[], confirmaciones: string[]): Promise<void> {
  const path = join(process.cwd(), "out", "control.csv");
  await mkdir(join(process.cwd(), "out"), { recursive: true });
  try { await readFile(path, "utf8"); } catch { await writeFile(path, "solicitud_id,resultado,numero_oc,retroactiva,bloqueos,confirmaciones,ts\n"); }
  const csv = (value: string) => `"${value.replace(/"/g, '""')}"`;
  await appendFile(path, [solicitudId, resultado, numeroOc, String(retroactiva), csv(bloqueos.join("|")), csv(confirmaciones.join("|")), new Date().toISOString()].join(",") + "\n");
}

async function appendLog(entry: Record<string, unknown>): Promise<void> {
  await mkdir(join(process.cwd(), "out"), { recursive: true });
  await appendFile(join(process.cwd(), "out", "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

export async function oc_leer_paquete(args: unknown): Promise<string> {
  try {
    const { caso: casoId } = toolSchemas.oc_leer_paquete.parse(args);
    const solicitud = await readJson<Solicitud>(casePath(casoId, "solicitud.json"));
    const correo = await readJson<Correo>(casePath(casoId, "correo.json"));
    const aprobacion = await readJson<Aprobacion>(casePath(casoId, "aprobacion.json")).catch(() => null);
    const cotizacion = parseQuote(await readText(casePath(casoId, "cotizacion.txt")).catch(() => ""));
    const facturaText = await readText(casePath(casoId, "factura.txt")).catch(() => "");
    const factura = facturaText ? parseFactura(facturaText) : null;
    const paquete: Paquete = { correo, solicitud, cotizacion: cotizacion.numero ? cotizacion : null, aprobacion, factura };
    await appendLog({ evento: "oc_leer_paquete", caso: casoId });
    return ok(paquete);
  } catch (error) { return fail(error); }
}

export async function oc_validar(args: unknown): Promise<string> {
  try {
    const { caso: casoId, paquete } = toolSchemas.oc_validar.parse(args);
    const p = paquete as Paquete;
    const { proveedores, centros } = await loadMasters();
    const blocks: Validacion["bloqueos"] = [];
    const confirmations: Validacion["confirmaciones"] = [];
    const derivados: Record<string, unknown> = {};
    const s = p.solicitud;
    const proveedor = proveedores.find((item) => (s.proveedor_nit && item.nit === s.proveedor_nit) || item.nombre.toLowerCase() === s.proveedor_nombre.toLowerCase());
    const centro = centros.find((item) => item.centro_costo === s.centro_costo);
    const approver = centro?.aprobadores.find((item) => item.email.toLowerCase() === (p.aprobacion?.de ?? "").toLowerCase());

    if (!proveedor || !proveedor.activo) blocks.push({ codigo: "RC1", motivo: `El proveedor ${s.proveedor_nombre} (${s.proveedor_nit}) no existe o está inactivo en el maestro.`, accion_sugerida: "Registrar o activar el proveedor y volver a validar." });
    if (!approver || !/aprobado/i.test(p.aprobacion?.cuerpo ?? "")) blocks.push({ codigo: "RC2", motivo: approver ? "El correo de aprobación no contiene la expresión de aprobación requerida." : `La aprobación proviene de ${p.aprobacion?.de ?? "un remitente desconocido"}, que no está autorizado para ${s.centro_costo}.`, accion_sugerida: "Solicitar aprobación al aprobador registrado para el centro de costo." });
    if (!approver || s.valor_total > approver.tope) blocks.push({ codigo: "RC3", motivo: `El valor ${money(s.valor_total)} supera el tope del aprobador autorizado para ${s.centro_costo}${approver ? ` (${money(approver.tope)})` : ""}.`, accion_sugerida: "Obtener aprobación con autoridad suficiente o escalar la compra." });
    if (!centro?.subareas.includes(s.subarea)) blocks.push({ codigo: "RC4", motivo: `La subárea ${s.subarea} no pertenece al centro ${s.centro_costo}.`, accion_sugerida: "Corregir el centro/subárea o solicitar la compra al centro correspondiente." });

    if (!p.cotizacion) confirmations.push({ codigo: "RC5", motivo: "No se encontró una cotización.", datos: { solicitud_total: s.valor_total } });
    else {
      const diff = Math.abs(p.cotizacion.total - s.valor_total) / Math.max(Math.abs(s.valor_total), 1);
      if (diff > 0.02) confirmations.push({ codigo: "RC5", motivo: "La diferencia entre solicitud y cotización supera el margen permitido del 2%.", datos: { solicitud_total: s.valor_total, cotizacion_total: p.cotizacion.total, diferencia_porcentual: Number((diff * 100).toFixed(2)) } });
    }

    if (!s.indicador_iva && proveedor?.indicador_iva_default) {
      derivados.indicador_iva = proveedor.indicador_iva_default;
      confirmations.push({ codigo: "RC6", motivo: "Falta el indicador IVA; se propone el valor por defecto del proveedor.", datos: { indicador_propuesto: proveedor.indicador_iva_default, proveedor: proveedor.nombre } });
    }
    if (!s.condiciones_pago && proveedor?.condiciones_pago_default) derivados.condiciones_pago = proveedor.condiciones_pago_default;

    const retroactiva = Boolean(p.factura && p.factura.fecha < s.fecha_solicitud);
    if (retroactiva) confirmations.push({ codigo: "RC8", motivo: "La factura fue emitida antes de la solicitud. La OC sería retroactiva.", datos: { fecha_factura: p.factura?.fecha, fecha_solicitud: s.fecha_solicitud, retroactiva: true } });
    if (p.aprobacion && p.aprobacion.fecha.slice(0, 10) < s.fecha_solicitud) confirmations.push({ codigo: "RC9", motivo: "La aprobación es anterior a la fecha de solicitud.", datos: { fecha_aprobacion: p.aprobacion.fecha, fecha_solicitud: s.fecha_solicitud } });

    const calculated = s.cantidad * s.valor_unitario;
    if (Math.abs(calculated - s.valor_total) > 1) blocks.push({ codigo: "RC10", motivo: `Cantidad × precio (${money(calculated)}) no coincide con el total (${money(s.valor_total)}).`, accion_sugerida: "Corregir la solicitud antes de crear la orden." });

    const result: Validacion = { apta: blocks.length === 0, bloqueos: blocks, confirmaciones: confirmations, derivados, retroactiva };
    await appendControl(casoId, s.solicitud_id, blocks.length ? "BLOQUEADA" : confirmations.length ? "PENDIENTE_CONFIRMACION" : "VALIDADA", "", retroactiva, blocks.map((b) => b.codigo), confirmations.map((c) => c.codigo));
    await appendLog({ evento: "oc_validar", caso: casoId, resultado: result });
    return ok(result);
  } catch (error) { return fail(error); }
}

function approvalEvidenceText(p: Paquete): string {
  const a = p.aprobacion;
  return [
    `DE: ${a?.de ?? ""}`,
    `PARA: ${a?.para ?? ""}`,
    `FECHA: ${a?.fecha ?? ""}`,
    `ASUNTO: ${a?.asunto ?? ""}`,
    "",
    a?.cuerpo ?? "",
  ].join("\n");
}

function buildMinimalPdf(text: string): Uint8Array {
  const safe = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E\n]/g, "?");
  const lines = safe.split("\n").flatMap((line) => {
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += 90) chunks.push(line.slice(i, i + 90));
    return chunks.length ? chunks : [""];
  });
  const commands = ["BT", "/F1 11 Tf", "50 760 Td", ...lines.flatMap((line, index) => [index ? "0 -16 Td" : "", `(${line.replace(/[()\\]/g, "\\$&")}) Tj`]).filter(Boolean), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export async function oc_construir_payload(args: unknown): Promise<string> {
  try {
    const { caso: casoId, paquete, derivados } = toolSchemas.oc_construir_payload.parse(args);
    const p = paquete as Paquete;
    const s = p.solicitud;
    const { proveedores } = await loadMasters();
    const proveedor = proveedores.find((item) => (s.proveedor_nit && item.nit === s.proveedor_nit) || item.nombre.toLowerCase() === s.proveedor_nombre.toLowerCase());
    if (!proveedor) return fail("No se encontró el proveedor en el maestro.");
    const evidenceText = approvalEvidenceText(p);
    const evidenceSha = sha256(evidenceText);
    const excepciones = Object.entries(derivados).map(([key, value]) => ({ codigo: `DER-${key.toUpperCase()}`, detalle: `Valor derivado: ${String(value)}`, confirmado_por: null }));
    const payload: OrdenCompra = {
      referencia: { solicitud_id: s.solicitud_id, correo_id: p.correo.id, cotizacion_ref: p.cotizacion?.numero ?? null },
      sociedad: "1000",
      organizacion_compras: "1000",
      proveedor: { codigo_sap: proveedor.codigo_sap, nit: proveedor.nit, nombre: proveedor.nombre },
      moneda: s.moneda,
      condiciones_pago: s.condiciones_pago ?? String(derivados.condiciones_pago ?? ""),
      aprobador: { email: p.aprobacion?.de ?? "", fecha_aprobacion: p.aprobacion?.fecha ?? "", evidencia_sha256: evidenceSha },
      posiciones: [{ numero: 10, descripcion: s.descripcion.slice(0, 40), cantidad: s.cantidad, unidad: "UN", precio_unitario: s.valor_unitario, centro_costo: s.centro_costo, subarea: s.subarea, indicador_iva: s.indicador_iva ?? String(derivados.indicador_iva ?? "") }],
      excepciones,
    };
    const dir = join(process.cwd(), "out", casoId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "trazabilidad.json"), JSON.stringify({
      solicitud_id: "solicitud.json",
      correo_id: "correo.json",
      proveedor: "maestro.proveedores.json",
      condiciones_pago: s.condiciones_pago ? "solicitud.condiciones_pago" : "maestro.proveedores.condiciones_pago_default",
      indicador_iva: s.indicador_iva ? "solicitud.indicador_iva" : "maestro.proveedores.indicador_iva_default",
      aprobador: "aprobacion.json",
      evidencia_sha256: "sha256(aprobacion.txt)",
    }, null, 2));
    await appendLog({ evento: "oc_construir_payload", caso: casoId, solicitud_id: s.solicitud_id });
    return ok({ payload, trace: `out/${casoId}/trazabilidad.json` });
  } catch (error) { return fail(error); }
}

export async function oc_generar_evidencia(args: unknown): Promise<string> {
  try {
    const { caso: casoId } = toolSchemas.oc_generar_evidencia.parse(args);
    const approval = await readJson<Aprobacion>(casePath(casoId, "aprobacion.json"));
    const content = approvalEvidenceText({ correo: { id: "", de: "", asunto: "", fecha: "", adjuntos: [] }, solicitud: {} as Solicitud, cotizacion: null, aprobacion: approval, factura: null });
    const hash = sha256(content);
    const dir = join(process.cwd(), "out", casoId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "aprobacion.txt"), `${content}\n\nSHA256: ${hash}\n`);
    await writeFile(join(dir, "aprobacion.pdf"), buildMinimalPdf(`${content}\n\nSHA256: ${hash}`));
    await appendLog({ evento: "oc_generar_evidencia", caso: casoId, sha256: hash });
    return ok({ ruta: `out/${casoId}/aprobacion.pdf`, ruta_txt: `out/${casoId}/aprobacion.txt`, sha256: hash });
  } catch (error) { return fail(error); }
}

export async function oc_crear(args: unknown): Promise<string> {
  try {
    const { caso: casoId, payload, confirmado } = toolSchemas.oc_crear.parse(args);
    if (confirmado !== true) return fail("La creación requiere confirmado=true.");
    const orden = payload as OrdenCompra;
    if (!orden.referencia?.solicitud_id || !orden.proveedor?.codigo_sap) return fail("El payload no contiene los campos mínimos para crear la OC.");

    const sap = new MockSapAdapter();
    const result = await sap.crearOrden(orden);
    await appendControl(
      casoId,
      orden.referencia.solicitud_id,
      result.idempotente ? "IDEMPOTENTE" : "CREADA",
      result.numero_oc,
      orden.excepciones.some((e) => e.codigo === "RETROACTIVA"),
      [],
      orden.excepciones.map((e) => e.codigo),
    );
    await appendLog({ evento: "oc_crear", caso: casoId, numero_oc: result.numero_oc, idempotente: result.idempotente });
    return ok(result);
  } catch (error) { return fail(error); }
}

export const tools = {
  oc_leer_paquete: { description: "Lee y normaliza correo, solicitud, cotización, aprobación y factura del caso.", args: toolSchemas.oc_leer_paquete, execute: oc_leer_paquete },
  oc_validar: { description: "Aplica todos los controles RC1-RC10 contra los documentos y maestros.", args: toolSchemas.oc_validar, execute: oc_validar },
  oc_construir_payload: { description: "Construye la OrdenCompra con trazabilidad y valores derivados.", args: toolSchemas.oc_construir_payload, execute: oc_construir_payload },
  oc_generar_evidencia: { description: "Genera evidencia de aprobación en TXT y PDF y calcula SHA-256.", args: toolSchemas.oc_generar_evidencia, execute: oc_generar_evidencia },
  oc_crear: { description: "Crea la orden en SAP simulado; exige confirmado=true e implementa idempotencia.", args: toolSchemas.oc_crear, execute: oc_crear },
};
