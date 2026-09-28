export interface Solicitud {
  solicitud_id: string;
  solicitante: string;
  proveedor_nombre: string;
  proveedor_nit?: string;
  descripcion: string;
  centro_costo: string;
  subarea: string;
  cantidad: number;
  valor_unitario: number;
  valor_total: number;
  moneda: "COP" | "USD";
  indicador_iva?: string;
  condiciones_pago?: string;
  fecha_solicitud: string;
}

export interface Cotizacion {
  numero: string;
  fecha: string;
  proveedor_nombre: string;
  proveedor_nit?: string;
  cantidad: number;
  valor_unitario: number;
  total: number;
  iva_porcentaje?: number;
  texto: string;
}

export interface Aprobacion {
  de: string;
  para: string;
  fecha: string;
  asunto: string;
  cuerpo: string;
}

export interface Factura {
  numero: string;
  fecha: string;
  proveedor_nombre: string;
  proveedor_nit?: string;
  total: number;
}

export interface Correo {
  id: string;
  de: string;
  asunto: string;
  fecha: string;
  adjuntos: string[];
}

export interface Paquete {
  correo: Correo;
  solicitud: Solicitud;
  cotizacion: Cotizacion | null;
  aprobacion: Aprobacion | null;
  factura: Factura | null;
}

export interface Confirmacion {
  codigo: string;
  motivo: string;
  datos: Record<string, unknown>;
}

export interface Bloqueo {
  codigo: string;
  motivo: string;
  accion_sugerida: string;
}

export interface Validacion {
  apta: boolean;
  bloqueos: Bloqueo[];
  confirmaciones: Confirmacion[];
  derivados: Record<string, unknown>;
  retroactiva: boolean;
}

export interface OrdenCompra {
  referencia: {
    solicitud_id: string;
    correo_id: string;
    cotizacion_ref: string | null;
  };
  sociedad: "1000";
  organizacion_compras: "1000";
  proveedor: {
    codigo_sap: string;
    nit: string;
    nombre: string;
  };
  moneda: "COP" | "USD";
  condiciones_pago: string;
  aprobador: {
    email: string;
    fecha_aprobacion: string;
    evidencia_sha256: string;
  };
  posiciones: Array<{
    numero: number;
    descripcion: string;
    cantidad: number;
    unidad: "UN" | "H" | "MES";
    precio_unitario: number;
    centro_costo: string;
    subarea: string;
    indicador_iva: string;
  }>;
  excepciones: Array<{
    codigo: string;
    detalle: string;
    confirmado_por: string | null;
  }>;
}

export interface SapCreateResult {
  numero_oc: string;
  fecha: string;
  idempotente: boolean;
}
