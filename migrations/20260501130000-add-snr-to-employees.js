'use strict';
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('Employees', 'snr_amount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 0
    });
    // Remove snr_amount from EmployeeRates since it's global per employee
    await queryInterface.removeColumn('EmployeeRates', 'snr_amount');
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('Employees', 'snr_amount');
    await queryInterface.addColumn('EmployeeRates', 'snr_amount', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
  }
};
