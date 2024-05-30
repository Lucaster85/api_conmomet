"use strict";
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Roles", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        type: Sequelize.STRING,
        unique: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      deleted_at: {
        type: Sequelize.DATE
      },
    });
    await queryInterface.bulkInsert("Roles", [
      { name: "superadmin", created_at: new Date(), updated_at: new Date() },
      { name: "admin", created_at: new Date(), updated_at: new Date() },
      { name: "manager", created_at: new Date(), updated_at: new Date() },
      { name: "provider", created_at: new Date(), updated_at: new Date() },
      { name: "customer", created_at: new Date(), updated_at: new Date() },
      { name: "user", created_at: new Date(), updated_at: new Date() },
    ]);
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("Roles");
  },
};
