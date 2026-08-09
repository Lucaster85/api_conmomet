"use strict";

/**
 * Migración de datos (no de esquema): resuelve BudgetMaterialItems.unit (texto libre) contra
 * el catálogo MaterialUnits recién creado, poblando material_unit_id. Si un valor de `unit`
 * no matchea ninguna unidad sembrada (ej. alguien ya había tipeado "litros" en vez de "L"),
 * se crea una fila nueva en MaterialUnits con ese texto tal cual, para no perder ni forzar
 * ningún dato existente. Opera con SQL crudo sobre TODAS las filas (incluidas soft-deleted),
 * porque la migración siguiente (finalize) pone material_unit_id NOT NULL a nivel de tabla —
 * una fila soft-deleted con NULL ahí también rompería esa constraint.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { QueryTypes } = queryInterface.sequelize;

    const items = await queryInterface.sequelize.query(
      `SELECT id, unit FROM BudgetMaterialItems WHERE material_unit_id IS NULL`,
      { type: QueryTypes.SELECT }
    );

    if (items.length === 0) return;

    const units = await queryInterface.sequelize.query(
      `SELECT id, label FROM MaterialUnits`,
      { type: QueryTypes.SELECT }
    );
    const unitIdByLabel = new Map(units.map((u) => [u.label.toLowerCase().trim(), u.id]));

    const now = new Date();

    for (const item of items) {
      const rawUnit = (item.unit || "u").trim() || "u";
      const key = rawUnit.toLowerCase();
      let unitId = unitIdByLabel.get(key);

      if (!unitId) {
        const [insertId] = await queryInterface.sequelize.query(
          `INSERT INTO MaterialUnits (label, display_order, is_active, created_at, updated_at) VALUES (:label, 0, true, :now, :now)`,
          { replacements: { label: rawUnit, now }, type: QueryTypes.INSERT }
        );
        unitId = insertId;
        unitIdByLabel.set(key, unitId);
      }

      await queryInterface.sequelize.query(
        `UPDATE BudgetMaterialItems SET material_unit_id = :unitId WHERE id = :id`,
        { replacements: { unitId, id: item.id }, type: QueryTypes.UPDATE }
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`UPDATE BudgetMaterialItems SET material_unit_id = NULL`);
  },
};
