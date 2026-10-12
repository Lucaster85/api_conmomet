"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Notifications", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      type: { type: DataTypes.STRING(40), allowNull: false },
      // Más largos que los topes del push (60/150) a propósito — ver models/notification.js.
      title: { type: DataTypes.STRING(120), allowNull: false },
      body: { type: DataTypes.STRING(500) },
      url: { type: DataTypes.STRING(255) },
      entity_type: { type: DataTypes.STRING(40) },
      entity_id: { type: DataTypes.INTEGER },
      read_at: { type: DataTypes.DATE },
      // SET NULL y no CASCADE: si se borra el usuario que generó la notificación, la notificación
      // del destinatario tiene que sobrevivir — el historial no se evapora porque alguien se fue.
      created_by: { type: DataTypes.INTEGER, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    // El contador del badge: COUNT por (user_id, read_at IS NULL). Es la query más frecuente de
    // todo el flujo (corre en cada carga de la app y en cada vuelta al foco).
    await queryInterface.addIndex("Notifications", ["user_id", "read_at"], { name: "notifications_user_read_idx" });
    // El feed paginado, ordenado por fecha descendente.
    await queryInterface.addIndex("Notifications", ["user_id", "created_at"], { name: "notifications_user_created_idx" });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("Notifications");
  },
};
