"use strict";
const { DataTypes } = require("sequelize");

/**
 * Talles adicionales de EPP por empleado, uno por artículo específico del catálogo (campera,
 * guantes de soldador, etc.) — además de los 3 básicos que siguen viviendo como columnas fijas
 * en Employees (shoe_size/shirt_size/pant_size). Sin deleted_at a propósito: con el índice
 * único de (employee_id, epp_item_id), un soft delete dejaría una fila fantasma que choca si se
 * vuelve a cargar el mismo talle más adelante, y es un dato trivial de recargar.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("EmployeeSizes", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      employee_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Employees", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      epp_item_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "EppItems", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      size: { type: DataTypes.STRING(10), allowNull: false },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("EmployeeSizes", ["employee_id", "epp_item_id"], {
      name: "employee_sizes_employee_item_unique",
      unique: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("EmployeeSizes");
  },
};
