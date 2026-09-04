"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Loans", "payment_method", {
      type: Sequelize.ENUM("efectivo", "transferencia"),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Loans", "payment_method");
  },
};
