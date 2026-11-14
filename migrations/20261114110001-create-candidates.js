"use strict";
const { DataTypes } = require("sequelize");

const userFk = {
  type: DataTypes.INTEGER,
  allowNull: true,
  references: { model: "Users", key: "id" },
  onUpdate: "CASCADE",
  onDelete: "SET NULL",
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Candidates", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      name: { type: DataTypes.STRING(50), allowNull: false },
      lastname: { type: DataTypes.STRING(50), allowNull: false },
      dni: { type: DataTypes.STRING(10), allowNull: true },
      cuil: { type: DataTypes.STRING(13), allowNull: true },
      email: { type: DataTypes.STRING(255), allowNull: true },
      phone: { type: DataTypes.STRING(30), allowNull: true },
      birth_date: { type: DataTypes.DATEONLY, allowNull: true },
      address: { type: DataTypes.STRING(255), allowNull: true },
      locality: { type: DataTypes.STRING(100), allowNull: true },
      trade: { type: DataTypes.STRING(100), allowNull: true },
      category_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Categories", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      years_experience: { type: DataTypes.INTEGER, allowNull: true },
      has_driver_license: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      source: {
        type: DataTypes.ENUM("web", "in_person", "referral", "other"),
        allowNull: false,
        defaultValue: "in_person",
      },
      referred_by_employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      consent_accepted_at: { type: DataTypes.DATE, allowNull: true },
      consent_version: { type: DataTypes.STRING(20), allowNull: true },
      consent_ip: { type: DataTypes.STRING(64), allowNull: true },
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      converted_at: { type: DataTypes.DATE, allowNull: true },
      converted_by: userFk,
      created_by: userFk,
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
    // Únicos: MySQL permite varios NULL, así que los candidatos sin DNI/CUIL no chocan entre sí.
    await queryInterface.addIndex("Candidates", ["dni"], { unique: true, name: "candidates_dni_unique" });
    await queryInterface.addIndex("Candidates", ["cuil"], { unique: true, name: "candidates_cuil_unique" });
    await queryInterface.addIndex("Candidates", ["employee_id"], { unique: true, name: "candidates_employee_id_unique" });
    // Para detectar duplicados por email al cargar.
    await queryInterface.addIndex("Candidates", ["email"], { name: "candidates_email_idx" });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Candidates");
  },
};
