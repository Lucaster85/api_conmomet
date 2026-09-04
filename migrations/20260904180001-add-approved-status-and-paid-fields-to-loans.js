"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE Loans
      MODIFY COLUMN status ENUM('pending','approved','active','rejected','completed','cancelled')
      NOT NULL DEFAULT 'active'
    `);

    await queryInterface.addColumn("Loans", "paid_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addColumn("Loans", "paid_by", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    // Los préstamos existentes con status 'active' ya estaban entregados.
    await queryInterface.sequelize.query(`
      UPDATE Loans SET paid_at = COALESCE(approved_at, start_date, created_at), paid_by = approved_by
      WHERE status = 'active'
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Loans", "paid_by");
    await queryInterface.removeColumn("Loans", "paid_at");

    await queryInterface.sequelize.query(`
      ALTER TABLE Loans
      MODIFY COLUMN status ENUM('pending','active','rejected','completed','cancelled')
      NOT NULL DEFAULT 'active'
    `);
  },
};
