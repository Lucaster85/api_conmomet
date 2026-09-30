"use strict";

/**
 * Los proyectos existentes tenían un único total en Project.budgeted_hours (sin desglose por
 * rubro) — se migra íntegro a la bolsa "Generales" (budget_item_type_id NULL) de cada proyecto,
 * ya que no hay forma de saber retroactivamente a qué rubro correspondían esas horas. Idempotente
 * (WHERE NOT EXISTS) por si se reintenta.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO \`ProjectHourBudgets\` (\`project_id\`, \`budget_item_type_id\`, \`budgeted_hours\`, \`created_at\`, \`updated_at\`)
      SELECT p.\`id\`, NULL, p.\`budgeted_hours\`, NOW(), NOW()
      FROM \`Projects\` p
      WHERE p.\`deleted_at\` IS NULL
        AND p.\`budgeted_hours\` IS NOT NULL
        AND p.\`budgeted_hours\` != 0
        AND NOT EXISTS (
          SELECT 1 FROM \`ProjectHourBudgets\` phb
          WHERE phb.\`project_id\` = p.\`id\` AND phb.\`budget_item_type_id\` IS NULL
        );
    `);
  },
  async down(queryInterface) {
    // No revierte de forma segura: borraría también bolsas "Generales" cargadas a mano después
    // del backfill. Sin down — igual criterio que otras migraciones de backfill de datos.
  },
};
