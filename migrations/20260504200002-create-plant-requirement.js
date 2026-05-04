"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("PlantRequirements", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      plant_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Plants", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      document_category_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "DocumentCategories", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      is_mandatory: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notes: { type: DataTypes.TEXT },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE },
    });

    // Unique constraint: a plant can only require a category once
    await queryInterface.addConstraint("PlantRequirements", {
      fields: ["plant_id", "document_category_id"],
      type: "unique",
      name: "uq_plant_requirement_category",
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("PlantRequirements");
  },
};
