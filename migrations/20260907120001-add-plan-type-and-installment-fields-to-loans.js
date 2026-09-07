"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Loans", "plan_type", {
      type: Sequelize.ENUM("discretionary", "fixed_installments"),
      allowNull: false,
      defaultValue: "discretionary",
    });
    await queryInterface.addColumn("Loans", "num_installments", {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn("Loans", "requested_num_installments", {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn("Loans", "monthly_interest_percent", {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
    });
    await queryInterface.addColumn("Loans", "installment_amount", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
    });
    await queryInterface.addColumn("Loans", "due_period_type", {
      type: Sequelize.ENUM("first_half", "second_half"),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Loans", "due_period_type");
    await queryInterface.removeColumn("Loans", "installment_amount");
    await queryInterface.removeColumn("Loans", "monthly_interest_percent");
    await queryInterface.removeColumn("Loans", "requested_num_installments");
    await queryInterface.removeColumn("Loans", "num_installments");
    await queryInterface.removeColumn("Loans", "plan_type");
  },
};
