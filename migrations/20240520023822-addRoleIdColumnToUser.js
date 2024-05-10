"use strict";
require('dotenv').config();

const { DataTypes } = require('sequelize');
const {encryptPass} = require("../helpers");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Users", "role_id", {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: "Roles",
        key: "id"
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE"
    });
    const password = await encryptPass( process.env.ADMIN_PASSWORD);
    await queryInterface.bulkInsert("Users", [{
      name: process.env.ADMIN_NAME,
      lastName:  process.env.ADMIN_LASTNAME,
      email:  process.env.ADMIN_EMAIL,
      password: password,
      role_id: 1,
      cuit: "11111111111"
    }])
  },

  async down(queryInterface, Sequelize) {
    return queryInterface.removeColumn("Users", "role_id");
  },
};
