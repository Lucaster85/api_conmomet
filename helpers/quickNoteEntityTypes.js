/**
 * Tipos de entidad a los que una nota rápida se puede vincular (ver FLOWS.md, flujo de Notas
 * rápidas — apartado "Vínculo a entidades: preparado, no habilitado").
 *
 * VACÍA a propósito: la estructura de la nota ya soporta el vínculo (`entity_type` + `entity_id`),
 * pero por ahora no se habilita ninguno. Mientras esté vacía, el controller rechaza con 400 cualquier
 * vínculo — la puerta existe, está cerrada.
 *
 * Mismo patrón de lista blanca que helpers/notificationTypes.js y helpers/alertTypes.js: sin ella,
 * cualquier usuario autenticado podría guardar un `entity_type` arbitrario.
 *
 * Para habilitar un tipo (ej. "budget") hace falta, además de sumarlo acá:
 * 1. Un resolver por tipo ({ model, label(e), url(e), permission }). `label` y `url` se calculan al
 *    LEER, no se guardan: así un presupuesto renombrado se ve bien y uno eliminado aparece como
 *    "no disponible".
 * 2. Al vincular, validar que la entidad exista Y que el usuario tenga el permiso de lectura de ese
 *    módulo — si no, una nota sería una forma de espiar registros que el rol no ve.
 * 3. Recordar que las notas siguen siendo privadas: "notas de este presupuesto" en una ficha
 *    mostraría solo las del propio usuario.
 */
const QUICK_NOTE_ENTITY_TYPES = [];

function isValidQuickNoteEntityType(entityType) {
  return QUICK_NOTE_ENTITY_TYPES.includes(entityType);
}

module.exports = { QUICK_NOTE_ENTITY_TYPES, isValidQuickNoteEntityType };
