'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // ===== Table: Loans =====

    // Add currency column after employee_id
    await queryInterface.addColumn('Loans', 'currency', {
      type: Sequelize.ENUM('USD', 'ARS'),
      allowNull: false,
      defaultValue: 'USD',
      after: 'employee_id'
    });

    // Rename amount_usd → amount
    await queryInterface.renameColumn('Loans', 'amount_usd', 'amount');

    // Rename remaining_balance_usd → remaining_balance
    await queryInterface.renameColumn('Loans', 'remaining_balance_usd', 'remaining_balance');

    // ALTER exchange_rate_at_origin to allowNull: true
    await queryInterface.changeColumn('Loans', 'exchange_rate_at_origin', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true
    });

    // ALTER amount_ars_at_origin to allowNull: true
    await queryInterface.changeColumn('Loans', 'amount_ars_at_origin', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true
    });

    // ===== Table: LoanPayments =====

    // Rename amount_usd → amount
    await queryInterface.renameColumn('LoanPayments', 'amount_usd', 'amount');

    // ALTER exchange_rate to allowNull: true
    await queryInterface.changeColumn('LoanPayments', 'exchange_rate', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true
    });

    // ALTER amount_ars to allowNull: true
    await queryInterface.changeColumn('LoanPayments', 'amount_ars', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: true
    });
  },

  async down(queryInterface, Sequelize) {
    // ===== Table: LoanPayments (reverse) =====

    // Revert amount_ars to allowNull: false
    await queryInterface.changeColumn('LoanPayments', 'amount_ars', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false
    });

    // Revert exchange_rate to allowNull: false
    await queryInterface.changeColumn('LoanPayments', 'exchange_rate', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false
    });

    // Rename amount → amount_usd
    await queryInterface.renameColumn('LoanPayments', 'amount', 'amount_usd');

    // ===== Table: Loans (reverse) =====

    // Revert amount_ars_at_origin to allowNull: false
    await queryInterface.changeColumn('Loans', 'amount_ars_at_origin', {
      type: Sequelize.DECIMAL(14, 2),
      allowNull: false
    });

    // Revert exchange_rate_at_origin to allowNull: false
    await queryInterface.changeColumn('Loans', 'exchange_rate_at_origin', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: false
    });

    // Rename remaining_balance → remaining_balance_usd
    await queryInterface.renameColumn('Loans', 'remaining_balance', 'remaining_balance_usd');

    // Rename amount → amount_usd
    await queryInterface.renameColumn('Loans', 'amount', 'amount_usd');

    // Remove currency column
    await queryInterface.removeColumn('Loans', 'currency');

    // Remove the ENUM type created by MySQL (cleanup)
    // Note: MySQL drops ENUM types automatically when the column is removed
  }
};
