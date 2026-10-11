---
"@anonly/shared": patch
"@anonly/render-engine": patch
"@anonly/anonymization-core": patch
"@anonly/react-client": patch
---

- La búsqueda y la selección sobre la vista anonimizada siguen la posición visible del texto, incluso cuando una etiqueta desplaza el resto del renglón. El texto tapado queda fuera de la selección (ADR-204).
- Si editás después de exportar, el diálogo avisa que hay cambios pendientes y permite generar una copia actualizada (ADR-205).
- Los menús de las entidades se mantienen dentro del área visible y un selector abierto en Configuración se cierra sin cerrar el diálogo (ADR-207).
- Los avisos breves se sustituyen y duran tres segundos; eliminar una entidad conserva la acción Deshacer y el aviso saliente deja de recibir foco.
- La búsqueda manual de actualizaciones confirma cuando el actualizador informa que estás usando la última versión; no confirma ante una búsqueda omitida o fallida (ADR-206).
