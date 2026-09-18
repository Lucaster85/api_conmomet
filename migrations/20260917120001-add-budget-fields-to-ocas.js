"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Ciclo de presentación del presupuesto a administración del cliente — independiente del
    // ciclo de aprobación de la OCA por el supervisor de obra (status). Opt-in: la mayoría de
    // las OCAs no requiere presupuesto, por eso default false.
    await queryInterface.addColumn("Ocas", "requires_budget", {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn("Ocas", "budget_status", {
      type: DataTypes.ENUM("pendiente", "presentado", "aprobado"),
      allowNull: true,
    });
    await queryInterface.addColumn("Ocas", "budget_approved_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("Ocas", "budget_approved_by", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
    await queryInterface.addColumn("Ocas", "budget_approved_by_supervisor_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "ClientSupervisors", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Ocas", "budget_approved_by_supervisor_id");
    await queryInterface.removeColumn("Ocas", "budget_approved_by");
    await queryInterface.removeColumn("Ocas", "budget_approved_at");
    await queryInterface.removeColumn("Ocas", "budget_status");
    await queryInterface.removeColumn("Ocas", "requires_budget");
  },
};
