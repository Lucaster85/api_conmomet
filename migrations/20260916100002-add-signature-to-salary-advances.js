"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("SalaryAdvances", "signature_url", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("SalaryAdvances", "signature_key", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("SalaryAdvances", "signature_name", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SalaryAdvances", "signature_name");
    await queryInterface.removeColumn("SalaryAdvances", "signature_key");
    await queryInterface.removeColumn("SalaryAdvances", "signature_url");
  },
};
