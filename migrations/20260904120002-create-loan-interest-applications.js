"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("LoanInterestApplications", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      loan_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Loans", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      applied_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      applied_at: { type: Sequelize.DATEONLY, allowNull: false },
      rate_percent_used: { type: Sequelize.DECIMAL(5, 2), allowNull: false },
      capital_before: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      interest_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      capital_after: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("LoanInterestApplications");
  },
};
