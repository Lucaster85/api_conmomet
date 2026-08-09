"use strict";

/**
 * `material_id` ya existe como columna en BudgetMaterialItems desde el plan original
 * ("FK futura a catálogo de materiales"), pero nunca tuvo una constraint real en la base ni
 * se usó — hoy está NULL en el 100% de las filas. Por eso esta migración NO necesita
 * backfill: solo agrega la foreign key real hacia la tabla Materials recién creada.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addConstraint("BudgetMaterialItems", {
      fields: ["material_id"],
      type: "foreign key",
      name: "budget_material_items_material_id_fkey",
      references: { table: "Materials", field: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.addIndex("BudgetMaterialItems", ["material_id"]);
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("BudgetMaterialItems", ["material_id"]);
    await queryInterface.removeConstraint("BudgetMaterialItems", "budget_material_items_material_id_fkey");
  },
};
