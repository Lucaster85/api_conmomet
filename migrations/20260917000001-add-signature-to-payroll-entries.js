"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("PayrollEntries", "signature_url", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("PayrollEntries", "signature_key", {
      type: Sequelize.STRING(500),
      allowNull: true,
    });
    await queryInterface.addColumn("PayrollEntries", "signature_name", {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn("PayrollEntries", "signed_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("PayrollEntries", "signed_by", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("PayrollEntries", "signed_by");
    await queryInterface.removeColumn("PayrollEntries", "signed_at");
    await queryInterface.removeColumn("PayrollEntries", "signature_name");
    await queryInterface.removeColumn("PayrollEntries", "signature_key");
    await queryInterface.removeColumn("PayrollEntries", "signature_url");
  },
};
