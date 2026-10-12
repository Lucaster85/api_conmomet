"use strict";

/**
 * Índice para el chequeo de idempotencia del barrido de vencimientos (ver FLOWS.md flujo 38):
 * "¿ya le notifiqué a este usuario este tipo para esta entidad?".
 *
 * Los dos índices que ya tiene la tabla —(user_id, read_at) para el badge y
 * (user_id, created_at) para el feed— no sirven para esa query: no incluyen `type` ni
 * `entity_id`, así que el chequeo degeneraría en un scan de todas las notificaciones del usuario
 * en cada barrido.
 *
 * NO es único a propósito: un mismo (usuario, tipo, entidad) puede repetirse legítimamente — te
 * asignan un PC, te lo quitan, te lo vuelven a asignar. La idempotencia del barrido es una
 * decisión de la lógica, no una restricción de la base.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex("Notifications", ["user_id", "type", "entity_id"], {
      name: "notifications_user_type_entity_idx",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("Notifications", "notifications_user_type_entity_idx");
  },
};
