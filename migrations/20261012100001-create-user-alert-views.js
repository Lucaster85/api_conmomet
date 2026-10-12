"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("UserAlertViews", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      alert_type: { type: DataTypes.STRING(40), allowNull: false },
      entity_id: { type: DataTypes.INTEGER, allowNull: false },
      // String opaco para el backend — ver models/userAlertView.js y FLOWS.md flujo 36.
      revision: { type: DataTypes.STRING(80), allowNull: false },
      seen_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    // El único a propósito: markSeen hace bulkCreate con updateOnDuplicate y depende de este
    // índice para que re-marcar un item actualice la fila en vez de duplicarla.
    await queryInterface.addIndex("UserAlertViews", ["user_id", "alert_type", "entity_id"], {
      unique: true,
      name: "user_alert_views_unique_idx",
    });
    await queryInterface.addIndex("UserAlertViews", ["user_id", "alert_type"], {
      name: "user_alert_views_user_type_idx",
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("UserAlertViews");
  },
};
