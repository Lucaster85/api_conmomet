"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("SalaryAdvances", "paid_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn("SalaryAdvances", "paid_by", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Los adelantos existentes con status 'approved' ya estaban entregados
    // (se creaban directamente aprobados y pagados antes de este cambio).
    await queryInterface.sequelize.query(`
      UPDATE SalaryAdvances SET paid_at = COALESCE(approved_at, date, created_at), paid_by = approved_by
      WHERE status = 'approved'
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SalaryAdvances", "paid_by");
    await queryInterface.removeColumn("SalaryAdvances", "paid_at");
  },
};
