"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("LoanPayments", "loan_installment_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "LoanInstallments", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("LoanPayments", "loan_installment_id");
  },
};
