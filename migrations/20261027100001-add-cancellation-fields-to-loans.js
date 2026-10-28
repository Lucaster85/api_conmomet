"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // `Loans.status` ya incluye "cancelled" — solo faltan las columnas de auditoría, mismo
    // esquema que SalaryAdvances (20260917100001).
    await queryInterface.addColumn("Loans", "cancelled_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("Loans", "cancelled_by", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    });
    await queryInterface.addColumn("Loans", "cancellation_reason", {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Loans", "cancellation_reason");
    await queryInterface.removeColumn("Loans", "cancelled_by");
    await queryInterface.removeColumn("Loans", "cancelled_at");
  },
};
