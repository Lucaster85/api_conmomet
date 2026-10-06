"use strict";
const { DataTypes } = require("sequelize");

/**
 * Bitácora de un proyecto/adicional: notas de seguimiento con fecha y autor ("se compró material
 * para tal cosa", "se hizo tal trabajo"), con fotos opcionales. Es un registro de solo agregar
 * (append-only): no se edita ni se borra, así que no lleva deleted_at. Una nota equivocada se
 * corrige con otra nota nueva.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ProjectLogEntries", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      project_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Projects", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      user_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "Users", key: "id" }, onUpdate: "CASCADE", onDelete: "RESTRICT",
      },
      note: { type: DataTypes.TEXT, allowNull: true, comment: "Puede ir vacía si la entrada solo trae fotos" },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ProjectLogEntries", ["project_id", "created_at"], { name: "project_log_entries_project_created" });

    await queryInterface.createTable("ProjectLogEntryFiles", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      entry_id: {
        type: DataTypes.INTEGER, allowNull: false,
        references: { model: "ProjectLogEntries", key: "id" }, onUpdate: "CASCADE", onDelete: "CASCADE",
      },
      file_url: { type: DataTypes.STRING(500), allowNull: false },
      file_key: { type: DataTypes.STRING(500), allowNull: true },
      file_name: { type: DataTypes.STRING(255), allowNull: true },
      mime_type: { type: DataTypes.STRING(120), allowNull: true },
      size_bytes: { type: DataTypes.INTEGER, allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ProjectLogEntryFiles", ["entry_id"]);
  },
  async down(queryInterface) {
    await queryInterface.dropTable("ProjectLogEntryFiles");
    await queryInterface.dropTable("ProjectLogEntries");
  },
};
