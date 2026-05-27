"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("SalaryAdvances", "payment_method", {
      type: Sequelize.ENUM("efectivo", "transferencia"),
      allowNull: false,
      defaultValue: "transferencia",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SalaryAdvances", "payment_method");
  }
};
