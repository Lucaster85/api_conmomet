"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("QuoteRequests", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      number: { type: DataTypes.STRING(30), allowNull: false, unique: true },
      // Número con el que el CLIENTE identifica su pedido (texto libre, cada cliente usa su
      // propia nomenclatura) — distinto de `number`, que es nuestro código interno PC-YYYY-NNN.
      client_quote_number: { type: DataTypes.STRING(100), allowNull: false },
      title: { type: DataTypes.STRING(200), allowNull: false },
      client_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Clients", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      plant_id: { type: DataTypes.INTEGER, references: { model: "Plants", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      description: { type: DataTypes.TEXT },
      received_at: { type: DataTypes.DATEONLY },
      due_date: { type: DataTypes.DATEONLY, allowNull: false },
      status: { type: DataTypes.ENUM("pending", "in_progress", "pending_review", "quoted", "cancelled"), allowNull: false, defaultValue: "pending" },
      notes: { type: DataTypes.TEXT },
      created_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
    await queryInterface.addIndex("QuoteRequests", ["client_id"]);
    await queryInterface.addIndex("QuoteRequests", ["due_date"]);
    await queryInterface.addIndex("QuoteRequests", ["status"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("QuoteRequests");
  },
};
