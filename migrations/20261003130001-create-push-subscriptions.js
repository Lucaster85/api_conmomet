"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("PushSubscriptions", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      user_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE" },
      // STRING(500), NUNCA TEXT: MySQL rechaza un índice único sobre TEXT (error 1170), y como
      // las migraciones corren al arrancar el container (ver Dockerfile), eso tumbaría el
      // deploy entero. Los endpoints reales miden 100-230 chars; InnoDB/utf8mb4 tolera hasta
      // 768 en una clave única, 500 sobra con margen (ver FLOWS.md flujo 28).
      endpoint: { type: DataTypes.STRING(500), allowNull: false, unique: true },
      p256dh: { type: DataTypes.STRING(255), allowNull: false },
      auth: { type: DataTypes.STRING(255), allowNull: false },
      user_agent: { type: DataTypes.STRING(512) },
      last_success_at: { type: DataTypes.DATE },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("PushSubscriptions", ["user_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("PushSubscriptions");
  },
};
