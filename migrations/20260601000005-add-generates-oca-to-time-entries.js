"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("TimeEntries");
    if (!table.generates_oca) {
      await queryInterface.addColumn("TimeEntries", "generates_oca", {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      });
    }
    
    // Para los datos de test existentes (usando sintaxis compatible con MySQL)
    await queryInterface.sequelize.query(
      "UPDATE TimeEntries SET generates_oca = true WHERE is_plant_hours = true;"
    );
    await queryInterface.sequelize.query(
      "UPDATE TimeEntries SET generates_oca = false WHERE is_plant_hours = false;"
    );
    
    // Check index before adding
    try {
      await queryInterface.addIndex("TimeEntries", ["generates_oca"]);
    } catch (e) {
      // Index might already exist, ignore
    }
  },

  async down(queryInterface) {
    try {
      await queryInterface.removeIndex("TimeEntries", ["generates_oca"]);
    } catch (e) {}
    try {
      await queryInterface.removeColumn("TimeEntries", "generates_oca");
    } catch (e) {}
  }
};
