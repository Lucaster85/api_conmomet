"use strict";
const { DataTypes } = require("sequelize");

/**
 * Horas manuales de un proyecto/adicional (FLOWS.md §56): horas que se registran a mano, con un
 * detalle ("20 hs de Construcción: armado en taller"), y que descuentan de la bolsa de horas del
 * rubro. Son solo de registro y estimación: no tienen empleado ni tarifa, así que nunca tocan la
 * liquidación, las OCAs, el costo de mano de obra ni el presupuesto.
 *
 * Tabla propia, no ProjectHourBudgets (se borra y recrea en cada sincronización con el
 * presupuesto) ni TimeEntries (exige empleado/ingreso/egreso y alimenta liquidación y OCAs).
 * No se editan ni se borran: una carga equivocada se anula con motivo (status 'voided'), por eso
 * no lleva deleted_at.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ProjectManualHours", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      project_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Projects", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      budget_item_type_id: {
        type: DataTypes.INTEGER, allowNull: true,
        references: { model: "BudgetItemTypes", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
        comment: "NULL = bolsa \"Generales\" (horas sin rubro).",
      },
      hours: { type: DataTypes.DECIMAL(8, 2), allowNull: false },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: false },
      status: { type: DataTypes.ENUM("active", "voided"), allowNull: false, defaultValue: "active" },
      created_by: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      voided_by: {
        type: DataTypes.INTEGER, allowNull: true,
        references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      voided_at: { type: DataTypes.DATE, allowNull: true },
      void_reason: { type: DataTypes.TEXT, allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ProjectManualHours", ["project_id", "status"], { name: "project_manual_hours_project_status" });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("ProjectManualHours");
  },
};
