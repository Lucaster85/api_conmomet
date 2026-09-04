"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE Loans
      MODIFY COLUMN status ENUM('pending','active','rejected','completed','cancelled')
      NOT NULL DEFAULT 'active'
    `);

    await queryInterface.addColumn("Loans", "requested_amount", {
      type: Sequelize.DECIMAL(12, 2),
      allowNull: true,
      after: "amount",
    });

    await queryInterface.addColumn("Loans", "interest_rate_percent", {
      type: Sequelize.DECIMAL(5, 2),
      allowNull: true,
    });

    await queryInterface.addColumn("Loans", "requested_by", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("Loans", "approved_at", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Loans", "approved_at");
    await queryInterface.removeColumn("Loans", "requested_by");
    await queryInterface.removeColumn("Loans", "interest_rate_percent");
    await queryInterface.removeColumn("Loans", "requested_amount");

    await queryInterface.sequelize.query(`
      ALTER TABLE Loans
      MODIFY COLUMN status ENUM('active','completed','cancelled')
      NOT NULL DEFAULT 'active'
    `);
  },
};
