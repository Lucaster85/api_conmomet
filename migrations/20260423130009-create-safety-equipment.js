"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("SafetyEquipments", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      employee_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Employees", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT" },
      item_name: { type: DataTypes.STRING(150), allowNull: false },
      delivered_date: { type: DataTypes.DATEONLY, allowNull: false },
      return_date: { type: DataTypes.DATEONLY },
      condition: { type: DataTypes.ENUM("new", "good", "worn", "damaged") },
      delivered_by: { type: DataTypes.INTEGER, references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "SET NULL" },
      notes: { type: DataTypes.TEXT },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("SafetyEquipments");
  },
};
