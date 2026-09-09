"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Loans", "rejection_reason", {
      type: Sequelize.TEXT,
      allowNull: true,
      after: "notes",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Loans", "rejection_reason");
  },
};
