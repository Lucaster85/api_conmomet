"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Tabla compartida entre herramientas y grúas/vehículos: exactamente uno de
    // tool_id/vehicle_id debe estar seteado — se valida en assetAssignmentController.js, no
    // acá (mismo criterio de "regla de negocio a nivel aplicación" que el resto del sistema).
    await queryInterface.createTable("AssetAssignments", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER,
      },
      tool_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Tools", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      vehicle_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Vehicles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Projects", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      // Responsable: obligatorio para herramientas, opcional para grúas — validado en el
      // controller, no acá.
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      status: {
        type: DataTypes.ENUM("reserved", "delivered", "returned"),
        allowNull: false,
      },
      delivered_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      returned_date: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      delivery_condition: {
        type: DataTypes.ENUM("bueno", "regular", "malo"),
        allowNull: true,
      },
      delivery_completeness: {
        type: DataTypes.ENUM("completo", "faltante"),
        allowNull: true,
      },
      delivery_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      return_condition: {
        type: DataTypes.ENUM("bueno", "regular", "malo"),
        allowNull: true,
      },
      return_completeness: {
        type: DataTypes.ENUM("completo", "faltante"),
        allowNull: true,
      },
      return_notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      delivered_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      received_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      created_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      updated_at: {
        allowNull: false,
        type: DataTypes.DATE,
        defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      deleted_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex("AssetAssignments", ["tool_id"]);
    await queryInterface.addIndex("AssetAssignments", ["vehicle_id"]);
    await queryInterface.addIndex("AssetAssignments", ["employee_id"]);
    await queryInterface.addIndex("AssetAssignments", ["project_id"]);
    await queryInterface.addIndex("AssetAssignments", ["status"]);
  },

  async down(queryInterface) {
    await queryInterface.dropTable("AssetAssignments");
  },
};
