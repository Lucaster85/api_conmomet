"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Budgets", "approved_by", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
    await queryInterface.addColumn("Budgets", "approved_document_url", {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: "Documento firmado subido a R2 al aprobar (opcional, igual que approved_img_url en Ocas)",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("Budgets", "approved_document_url");
    await queryInterface.removeColumn("Budgets", "approved_by");
  },
};
