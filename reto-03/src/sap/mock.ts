import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OrdenCompra, SapCreateResult } from "../types";
import type { SapAdapter } from "./adapter";

interface SapRow {
  numero_oc: string;
  fecha: string;
  solicitud_id: string;
  payload: OrdenCompra;
}

export class MockSapAdapter implements SapAdapter {
  private readonly file = join(process.cwd(), "out", "sap", "ordenes.jsonl");

  private async rows(): Promise<SapRow[]> {
    const text = await readFile(this.file, "utf8").catch(() => "");
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SapRow);
  }

  async consultarProveedor(nit: string): Promise<{ codigo_sap: string; activo: boolean } | null> {
    const rows = await this.rows();
    const row = rows.find((item) => item.payload.proveedor.nit === nit);
    return row ? { codigo_sap: row.payload.proveedor.codigo_sap, activo: true } : null;
  }

  async buscarOrdenPorReferencia(solicitud_id: string): Promise<{ numero_oc: string } | null> {
    const row = (await this.rows()).find((item) => item.solicitud_id === solicitud_id);
    return row ? { numero_oc: row.numero_oc } : null;
  }

  async crearOrden(orden: OrdenCompra): Promise<SapCreateResult> {
    await mkdir(join(process.cwd(), "out", "sap"), { recursive: true });
    const existing = await this.buscarOrdenPorReferencia(orden.referencia.solicitud_id);
    if (existing) {
      return { numero_oc: existing.numero_oc, fecha: new Date().toISOString(), idempotente: true };
    }

    const rows = await this.rows();
    const numero_oc = String(4500000001 + rows.length);
    const fecha = new Date().toISOString();
    await appendFile(this.file, JSON.stringify({
      numero_oc,
      fecha,
      solicitud_id: orden.referencia.solicitud_id,
      payload: orden,
    }) + "\n");
    return { numero_oc, fecha, idempotente: false };
  }
}
