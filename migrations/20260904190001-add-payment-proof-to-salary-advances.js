"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("SalaryAdvances", "payment_proof_url", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("SalaryAdvances", "payment_proof_key", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("SalaryAdvances", "payment_proof_name", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SalaryAdvances", "payment_proof_name");
    await queryInterface.removeColumn("SalaryAdvances", "payment_proof_key");
    await queryInterface.removeColumn("SalaryAdvances", "payment_proof_url");
  },
};
