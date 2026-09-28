# Conocimiento funcional

Este archivo contiene conocimiento estable del proceso. La lógica ejecutable está en `src/tools/oc.ts`.

- El agente procesa paquetes de solicitud, cotización, aprobación y factura cuando existe.
- Las validaciones RC1 a RC10 determinan bloqueos, confirmaciones y derivados.
- La creación de la OC se realiza únicamente después de superar los bloqueos y las confirmaciones requeridas.
- El SAP usado en este reto es simulado.
