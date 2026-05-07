'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Remove snr_amount from Employees
    // (Also making category_id required is part of the validation, not DB for now, or maybe DB later. 
    // Plan says "en DB se mantiene nullable por ahora")
    await queryInterface.removeColumn('Employees', 'snr_amount');

    // 2. Remove fields from PayrollEntries
    await queryInterface.removeColumn('PayrollEntries', 'extra_payments');
    await queryInterface.removeColumn('PayrollEntries', 'extra_payments_notes');
    await queryInterface.removeColumn('PayrollEntries', 'deductions');
    await queryInterface.removeColumn('PayrollEntries', 'deductions_notes');
  },

  async down(queryInterface, Sequelize) {
    // Reverse Employee
    await queryInterface.addColumn('Employees', 'snr_amount', {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true
    });

    // Reverse PayrollEntries
    await queryInterface.addColumn('PayrollEntries', 'extra_payments', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0
    });
    await queryInterface.addColumn('PayrollEntries', 'extra_payments_notes', {
      type: Sequelize.TEXT
    });
    await queryInterface.addColumn('PayrollEntries', 'deductions', {
      type: Sequelize.DECIMAL(10, 2),
      defaultValue: 0
    });
    await queryInterface.addColumn('PayrollEntries', 'deductions_notes', {
      type: Sequelize.TEXT
    });
  }
};
