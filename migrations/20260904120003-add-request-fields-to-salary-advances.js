"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("SalaryAdvances", "status", {
      type: Sequelize.ENUM("pending", "approved", "rejected"),
      allowNull: false,
      defaultValue: "pending",
    });

    // Los adelantos existentes ya fueron creados directamente aprobados por el admin.
    await queryInterface.sequelize.query(`UPDATE SalaryAdvances SET status = 'approved'`);

    await queryInterface.addColumn("SalaryAdvances", "requested_amount", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });

    await queryInterface.addColumn("SalaryAdvances", "requested_by", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("SalaryAdvances", "approved_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.changeColumn("SalaryAdvances", "payment_method", {
      type: Sequelize.ENUM("efectivo", "transferencia"),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("SalaryAdvances", "payment_method", {
      type: Sequelize.ENUM("efectivo", "transferencia"),
      allowNull: false,
      defaultValue: "transferencia",
    });
    await queryInterface.removeColumn("SalaryAdvances", "approved_at");
    await queryInterface.removeColumn("SalaryAdvances", "requested_by");
    await queryInterface.removeColumn("SalaryAdvances", "requested_amount");
    await queryInterface.removeColumn("SalaryAdvances", "status");
  },
};
