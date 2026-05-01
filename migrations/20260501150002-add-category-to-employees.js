"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Employees", "category_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Categories", key: "id" },
      after: "position",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Employees", "category_id");
  },
};
