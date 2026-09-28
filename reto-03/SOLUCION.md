# SOLUCION.md
## Reto técnico 03 — Agente conversacional Órdenes de Compra SAP

## 1. Problema y objetivo

La solución implementa un agente conversacional para apoyar el proceso de creación de Órdenes de Compra (OC) a partir de un paquete de solicitud compuesto por correo, solicitud, cotización, aprobación y, cuando aplica, factura.

El agente debe leer y normalizar la información, contrastarla contra los maestros disponibles, identificar bloqueos y situaciones que requieren confirmación humana, construir el payload de la Orden de Compra, generar evidencia y crear una OC mediante un adaptador SAP simulado.

La automatización no sustituye las decisiones humanas cuando existe una condición que el proceso define como confirmable. Los valores críticos no deben ser modificados por el modelo para hacerlos coincidir.

---

## 2. Arquitectura de la solución

La solución se organiza separando comportamiento, conocimiento, herramientas, orquestación, integración y presentación.

```text
reto-03/
├── agent/
│   └── prompt.md
├── src/
│   ├── agent/
│   │   └── service.ts
│   ├── tools/
│   │   └── oc.ts
│   ├── llm/
│   │   ├── adapter.ts
│   │   └── mock.ts
│   ├── sap/
│   │   ├── adapter.ts
│   │   └── mock.ts
│   ├── knowledge/
│   │   └── ordenes-compra.md
│   ├── types.ts
│   └── server.ts
├── web/
├── fixtures/
├── out/
├── demo.ts
├── package.json
├── README.md
└── SOLUCION.md
```

### Separación de responsabilidades

- `agent/prompt.md`: comportamiento y reglas de actuación del agente.
- `src/tools/oc.ts`: herramientas de órdenes de compra y reglas de negocio; utiliza esquemas Zod para tipar argumentos.
- `src/agent/service.ts`: orquesta el ciclo de lectura, validación, confirmación y creación.
- `src/llm/`: abstrae el proveedor de modelo de lenguaje.
- `src/sap/`: abstrae la integración con SAP y contiene el adaptador simulado.
- `src/knowledge/`: conocimiento funcional separado del prompt.
- `src/server.ts`: backend y API.
- `web/`: interfaz de chat.
- `fixtures/`: maestros y los seis casos de prueba.
- `out/`: archivos de trazabilidad, control, evidencias y órdenes simuladas.
- `demo.ts`: verificación determinística sin LLM.

Esta separación permite reemplazar el modelo de lenguaje o el adaptador SAP sin modificar las reglas centrales del proceso.

---

## 3. Ciclo del agente

El ciclo implementado sigue el siguiente orden:

```text
Solicitud del usuario
        ↓
Leer paquete
        ↓
Validar contra maestros
        ↓
¿Hay bloqueos?
   ├── Sí → informar bloqueo y detener
   └── No
        ↓
¿Hay confirmaciones?
   ├── Sí → solicitar confirmación humana
   └── No / confirmado
        ↓
Construir payload
        ↓
Generar evidencia
        ↓
Crear OC
        ↓
Registrar trazabilidad
```

### Herramientas principales

1. `oc_leer_paquete`
   - Lee los archivos del caso y devuelve un paquete normalizado.

2. `oc_validar`
   - Ejecuta las reglas RC1–RC10.
   - Devuelve `apta`, `bloqueos`, `confirmaciones`, `derivados` y `retroactiva`.

3. `oc_construir_payload`
   - Construye la estructura de OrdenCompra utilizando los datos validados y derivados.

4. `oc_generar_evidencia`
   - Genera evidencia del caso y calcula su SHA-256.

5. `oc_crear`
   - Crea la Orden de Compra mediante el adaptador SAP.
   - Mantiene idempotencia por `solicitud_id`.

Las herramientas devuelven resultados estructurados y no deben lanzar excepciones como mecanismo normal de negocio.

---

## 4. Matriz de controles

| Control | Regla | Resultado |
|---|---|---|
| RC1 | El proveedor debe existir por NIT o nombre normalizado y estar activo. | BLOQUEO |
| RC2 | Debe existir aprobación y el correo aprobador debe estar autorizado para el centro. | BLOQUEO |
| RC3 | El valor total debe estar dentro del tope de aprobación aplicable. | BLOQUEO |
| RC4 | La subárea debe pertenecer al centro de costo. | BLOQUEO |
| RC5 | La diferencia entre cotización y solicitud debe ser ≤ 2%. Si supera el límite, requiere confirmación. Si no existe cotización, también requiere confirmación. | CONFIRMACIÓN |
| RC6 | Si falta IVA, se deriva desde `indicador_iva_default` del proveedor. | CONFIRMACIÓN |
| RC7 | Si faltan condiciones de pago, se derivan desde el proveedor. | INFORMATIVO |
| RC8 | Si la factura es anterior a la solicitud, se marca `retroactiva=true`. | CONFIRMACIÓN |
| RC9 | La aprobación debe ser posterior o igual a la fecha de solicitud. | CONFIRMACIÓN |
| RC10 | Cantidad × precio unitario debe coincidir con el total con tolerancia de una unidad monetaria. | BLOQUEO |

### Aplicación sobre los seis casos

- `SOL-001`: supera los controles sin bloqueos ni confirmaciones y puede continuar a creación.
- `SOL-002`: se bloquea por proveedor inexistente en maestros.
- `SOL-003`: se bloquea por aprobación no autorizada para el centro y por límite de aprobación.
- `SOL-004`: requiere confirmación por diferencia del 6% entre solicitud y cotización.
- `SOL-005`: requiere confirmación porque la factura es anterior a la solicitud y se marca como retroactiva.
- `SOL-006`: requiere confirmación por IVA faltante; el indicador se deriva del proveedor. La condición de pago se deriva de forma informativa.

---

## 5. Confirmación humana y controles de seguridad

La creación de la OC no debe ejecutarse cuando existen bloqueos.

Cuando existen confirmaciones, el agente debe detener el ciclo y solicitar una decisión explícita del usuario. La confirmación se conserva como parte del estado de la interacción antes de continuar.

El modelo no debe inventar datos ni modificar silenciosamente valores críticos. Por ejemplo, en `SOL-004` no debe reemplazar el valor de la solicitud por el valor de la cotización para evitar la confirmación.

Las llamadas a herramientas deben ser visibles en el chat y registrarse en la trazabilidad.

El ciclo debe tener un límite de iteraciones para evitar ejecuciones indefinidas.

---

## 6. Idempotencia y trazabilidad

La creación de la OC utiliza `solicitud_id` como clave de idempotencia.

En el adaptador simulado:

- Las órdenes creadas se almacenan en `out/sap/ordenes.jsonl` mediante `MockSapAdapter`.
- Los intentos de creación se registran en `out/control.csv`.
- Las llamadas y eventos del agente se registran en `out/log.jsonl`.
- La evidencia de cada caso se almacena en `out/<caso>/aprobacion.txt` y `out/<caso>/aprobacion.pdf`.

La prueba determinística `demo.ts` ejecuta `SOL-001` nuevamente para comprobar que una segunda ejecución no genere una segunda OC para la misma solicitud.

---

## 7. Diseño de un adaptador SAP real para producción

El reto utiliza un adaptador SAP simulado para mantener la solución independiente de un sistema SAP real. En producción, el componente `src/sap/adapter.ts` debe conservar una interfaz estable y delegar la comunicación a una implementación concreta.

### Interfaz implementada

`src/sap/adapter.ts` define `consultarProveedor`, `crearOrden` y `buscarOrdenPorReferencia`. `src/sap/mock.ts` implementa estas operaciones sobre `out/sap/ordenes.jsonl`, incluyendo idempotencia por `solicitud_id`.

### Mapeo

El objeto interno `OrdenCompra` debe mapearse a la estructura requerida por la interfaz SAP seleccionada. El mapeo debe mantener como mínimo:

- proveedor;
- centro de costo;
- subárea;
- moneda;
- condiciones de pago;
- indicador de IVA;
- posición/material o descripción;
- cantidad;
- precio unitario;
- total;
- referencia a `solicitud_id`.

El contrato definitivo debe ajustarse a la interfaz SAP disponible en el ambiente productivo.

### Autenticación y credenciales

Las credenciales no deben almacenarse en el código fuente ni en fixtures. Deben administrarse mediante variables de entorno y, en producción, mediante el mecanismo seguro de secretos disponible en la infraestructura.

La interfaz del adaptador no debe exponer secretos al frontend.

### Idempotencia

La operación debe conservar `solicitud_id` como identificador de negocio para evitar duplicados.

Antes de crear una nueva OC, la implementación productiva debe poder consultar o garantizar una clave de idempotencia en el mecanismo de integración utilizado.

### Errores y errores parciales

El adaptador debe diferenciar:

- errores de validación;
- errores de autenticación;
- errores de comunicación;
- rechazos funcionales de SAP;
- respuestas ambiguas o timeouts;
- creación aceptada pero sin respuesta completa.

En un timeout no se debe asumir automáticamente que la OC no fue creada. Debe existir una estrategia de consulta por identificador/idempotencia antes de reintentar.

### Plan B

Si SAP no está disponible, la solución debe conservar el intento y su trazabilidad, evitar duplicados y dejar el caso preparado para reintento controlado.

El adaptador simulado puede utilizarse durante desarrollo y pruebas, mientras que la implementación productiva se conecta al mecanismo de integración SAP autorizado por la organización.

---

## 8. Análisis crítico de las órdenes retroactivas

Una orden retroactiva aparece cuando la documentación muestra que la adquisición o facturación ocurrió antes de la solicitud formal de compra.

En `SOL-005`:

```text
Fecha de factura:     2026-08-10
Fecha de solicitud:   2026-08-27

Factura < Solicitud
        ↓
retroactiva = true
        ↓
confirmación humana
        ↓
no creación automática
```

### Desvío identificado

El desvío consiste en que existe evidencia de una factura anterior a la solicitud de compra. Esto indica que el flujo operativo real no siguió el orden esperado de solicitud, aprobación y posterior adquisición/facturación.

La automatización debe identificar el hecho, pero no debe intentar justificarlo ni alterar las fechas para normalizar artificialmente el expediente.

### Tratamiento propuesto

La solución marca el caso como `retroactiva=true`, registra la condición y solicita confirmación humana antes de crear la OC.

Esta decisión mantiene separadas dos responsabilidades:

1. Detectar objetivamente el desvío.
2. Decidir si la organización permite continuar con una OC retroactiva.

La regla de negocio sobre si una OC retroactiva debe permitirse, rechazarse o requerir una autorización adicional debe ser definida por la organización. En ausencia de esa política explícita, la solución no toma la decisión automáticamente.

---

## 9. Trade-offs y decisiones de diseño

### Lógica determinística vs. LLM

Se mantiene la validación crítica en herramientas determinísticas. El LLM se utiliza para interacción y orquestación, no para decidir arbitrariamente si una regla de negocio se cumple.

### Adaptador SAP simulado vs. integración real

El mock permite demostrar el proceso sin acceso a infraestructura SAP real. La interfaz separada permite sustituirlo posteriormente.

### Confirmación humana vs. automatización completa

Se conserva intervención humana en diferencias de cotización, IVA faltante y operaciones retroactivas. Esto reduce el riesgo de que una interpretación automática genere una OC incorrecta.

### Fixtures vs. datos externos

Los fixtures permiten reproducibilidad y facilitan la defensa técnica. En producción, los maestros deberían provenir de fuentes corporativas autorizadas.

---

## 10. Supuestos

- Los maestros proporcionados para el reto se consideran la fuente de referencia.
- La aprobación por correo se considera evidencia válida para el ejercicio.
- El adaptador SAP utilizado en el reto es simulado.
- La política definitiva para operaciones retroactivas no está completamente definida en el material del reto; por ello se solicita confirmación humana.
- La integración SAP real deberá ajustarse al mecanismo disponible en el ambiente productivo.

---

## 11. Cobertura

La solución contempla los seis casos entregados:

| Caso | Bloqueo | Confirmación | Retroactiva | Creación automática |
|---|---|---|---|---|
| SOL-001 | No | No | No | Sí |
| SOL-002 | Sí | No | No | No |
| SOL-003 | Sí | No | No | No |
| SOL-004 | No | Sí | No | No hasta confirmar |
| SOL-005 | No | Sí | Sí | No hasta confirmar |
| SOL-006 | No | Sí | No | No hasta confirmar |

---

## 12. Uso de IA

Se utilizó ChatGPT como asistente de construcción para apoyar diseño, implementación, revisión de reglas y documentación.

En ejecución, el backend puede usar un proveedor compatible con la API de Chat Completions mediante `src/llm/provider.ts`. La clave se lee únicamente desde `LLM_API_KEY`. Si la clave no está configurada, la aplicación conserva un fallback local y las validaciones críticas siguen funcionando de forma determinística.

Las reglas críticas de validación, construcción de payload y creación de OC permanecen en herramientas y adaptadores determinísticos. El modelo recibe los resultados de esas herramientas para redactar la respuesta al usuario; no puede alterar silenciosamente los valores validados.

---

## 13. Riesgos para producción

Antes de una implementación productiva deberían revisarse, como mínimo:

- autenticación y autorización contra SAP;
- manejo seguro de secretos;
- disponibilidad y latencia de SAP;
- estrategia de reintentos;
- idempotencia extremo a extremo;
- auditoría de cambios;
- protección de información sensible;
- controles de acceso al frontend y backend;
- observabilidad y alertas;
- definición formal de la política para órdenes retroactivas;
- validación de los maestros y su frecuencia de actualización.

---

## 14. Conclusión

La solución separa la conversación de la ejecución crítica: el agente puede interpretar y orquestar, pero las reglas de negocio y la creación de la OC están controladas por herramientas y adaptadores.

Los seis casos del reto quedan cubiertos mediante una combinación de bloqueos, confirmaciones humanas, derivaciones controladas, trazabilidad e idempotencia.

El adaptador SAP simulado permite demostrar el flujo sin requerir acceso a SAP real, mientras que la arquitectura propuesta permite sustituirlo por una integración productiva sin modificar el núcleo de las reglas de negocio.
