"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("Projects", "parent_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Projects", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
    await queryInterface.addIndex("Projects", ["parent_id"]);
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("Projects", ["parent_id"]);
    await queryInterface.removeColumn("Projects", "parent_id");
  },
};
