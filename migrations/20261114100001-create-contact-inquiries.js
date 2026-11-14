"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ContactInquiries", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      reason: {
        type: DataTypes.ENUM("budget_request", "general", "supplier", "other"),
        allowNull: false,
      },
      name: { type: DataTypes.STRING(120), allowNull: false },
      company: { type: DataTypes.STRING(150), allowNull: true },
      phone: { type: DataTypes.STRING(40), allowNull: true },
      email: { type: DataTypes.STRING(150), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      status: {
        type: DataTypes.ENUM("new", "in_progress", "closed"),
        allowNull: false,
        defaultValue: "new",
      },
      internal_notes: { type: DataTypes.TEXT, allowNull: true },
      handled_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      handled_at: { type: DataTypes.DATE, allowNull: true },
      closed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      closed_at: { type: DataTypes.DATE, allowNull: true },
      // Se guardan para rastrear abuso del endpoint público (ver middlewares/publicForm.js).
      source_ip: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(255), allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex("ContactInquiries", ["status", "created_at"], {
      name: "contact_inquiries_status_idx",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("ContactInquiries");
  },
};
