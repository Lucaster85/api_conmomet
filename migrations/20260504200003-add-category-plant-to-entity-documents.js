"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("EntityDocuments", "document_category_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "DocumentCategories", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      after: "entity_id",
    });

    await queryInterface.addColumn("EntityDocuments", "target_plant_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "Plants", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
      after: "document_category_id",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("EntityDocuments", "target_plant_id");
    await queryInterface.removeColumn("EntityDocuments", "document_category_id");
  },
};
