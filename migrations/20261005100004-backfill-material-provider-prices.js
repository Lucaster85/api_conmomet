"use strict";

/**
 * Todo costo pasa a ser por proveedor: el costo actual de cada Material (Materials.current_cost)
 * se copia como precio del proveedor de sistema "Sin especificar". Idempotente.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      INSERT INTO MaterialProviderPrices (material_id, provider_id, cost, currency, created_at, updated_at)
      SELECT m.id, (SELECT id FROM Providers WHERE is_system = true LIMIT 1), m.current_cost, m.currency, NOW(), NOW()
      FROM Materials m
      WHERE m.current_cost IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM MaterialProviderPrices p
          WHERE p.material_id = m.id
            AND p.provider_id = (SELECT id FROM Providers WHERE is_system = true LIMIT 1)
        )
    `);
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DELETE FROM MaterialProviderPrices
      WHERE provider_id = (SELECT id FROM Providers WHERE is_system = true LIMIT 1)
    `);
  },
};
