"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("LoanChangeAlerts", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      loan_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Loans", key: "id" },
      },
      employee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Employees", key: "id" },
      },
      action: {
        type: Sequelize.ENUM("rescheduled", "cancelled"),
        allowNull: false,
      },
      justification: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      previous_terms: {
        type: Sequelize.JSON,
        allowNull: false,
      },
      // null en una cancelación — no hay términos nuevos.
      new_terms: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("LoanChangeAlerts");
  },
};
