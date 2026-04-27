'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Roles', 'has_dashboard_access', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Roles', 'has_dashboard_access');
  }
};
