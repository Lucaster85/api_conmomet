"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Loans", "signature_url", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("Loans", "signature_key", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("Loans", "signature_name", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Loans", "signature_name");
    await queryInterface.removeColumn("Loans", "signature_key");
    await queryInterface.removeColumn("Loans", "signature_url");
  },
};
