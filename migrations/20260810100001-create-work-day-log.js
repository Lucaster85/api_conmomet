"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("WorkDayLogs", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      project_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Projects", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      date: { type: DataTypes.DATEONLY, allowNull: false },
      start_time: { type: DataTypes.TIME, allowNull: true },
      end_time: { type: DataTypes.TIME, allowNull: true },
      suspension_reason: { type: DataTypes.STRING(150), allowNull: true },
      suspended_by: { type: DataTypes.STRING(100), allowNull: true },
      observations: { type: DataTypes.TEXT, allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });

    await queryInterface.addIndex("WorkDayLogs", ["project_id", "date"], {
      unique: true,
      name: "work_day_logs_project_id_date_unique",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("WorkDayLogs");
  },
};
