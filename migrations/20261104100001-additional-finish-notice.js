"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // "Notificar finalización" de un adicional (ver FLOWS.md §50). Cuándo y quién avisó que el
    // adicional terminó, para armar la línea "Finalización notificada el dd/mm a X, Y" y para que
    // la tarjeta del tablero ("Adicionales para presupuestar") pueda reaparecer si se vuelve a
    // notificar (su revisión es finish_notified_at).
    await queryInterface.addColumn("Projects", "finish_notified_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("Projects", "finish_notified_by", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Gerencia a la que se le pidió cerrar el presupuesto del adicional. Mismo esquema que
    // quote_request_assignee. Sin backfill: los adicionales que hoy están completados no tienen
    // responsable y no aparecen en la tarjeta.
    await queryInterface.createTable("AdditionalBudgetAssignees", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      project_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Projects", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("AdditionalBudgetAssignees", ["project_id", "user_id"], {
      unique: true,
      name: "additional_budget_assignees_project_user",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("AdditionalBudgetAssignees");
    await queryInterface.removeColumn("Projects", "finish_notified_by");
    await queryInterface.removeColumn("Projects", "finish_notified_at");
  },
};
