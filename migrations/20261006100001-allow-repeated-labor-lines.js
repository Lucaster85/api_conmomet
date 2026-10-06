"use strict";

/**
 * Permite repetir un rubro dentro del mismo presupuesto (ej. 20 hs de Construcción a un precio
 * y 30 hs a otro). Se borra el índice único (budget_id, budget_item_type_id).
 *
 * ORDEN IMPORTANTE: primero se crea un índice simple sobre budget_id y recién después se borra el
 * único. MySQL usa el índice compuesto para respaldar la FK de budget_id, y no deja borrarlo si no
 * hay otro índice que la cubra.
 *
 * DOWN: re-crea el único, así que FALLA si ya hay presupuestos con un rubro repetido. En ese caso
 * hay que unificar o borrar las líneas repetidas a mano antes de revertir.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addIndex("BudgetLaborLines", ["budget_id"], { name: "budget_labor_lines_budget_id" });
    await queryInterface.removeIndex("BudgetLaborLines", "budget_labor_lines_budget_item_type_unique");
  },
  async down(queryInterface) {
    await queryInterface.addIndex("BudgetLaborLines", ["budget_id", "budget_item_type_id"], {
      unique: true,
      name: "budget_labor_lines_budget_item_type_unique",
    });
    await queryInterface.removeIndex("BudgetLaborLines", "budget_labor_lines_budget_id");
  },
};
