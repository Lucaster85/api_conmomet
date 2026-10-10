"use strict";
const { DataTypes } = require("sequelize");

/**
 * Paso 2 de 2: elimina shoe_size/shirt_size/pant_size de Employees. Paso 1
 * (migrations/20261009100002-backfill-employee-sizes.js) ya copió estos datos a
 * EmployeeSizes — confirmado en local, test y producción antes de correr esta.
 *
 * `down` reconstruye las columnas vacías (no hay nada que restaurar ahí, el dato real sigue
 * en EmployeeSizes), solo para que el rollback del esquema sea seguro.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.removeColumn("Employees", "shoe_size");
    await queryInterface.removeColumn("Employees", "shirt_size");
    await queryInterface.removeColumn("Employees", "pant_size");
  },
  async down(queryInterface) {
    await queryInterface.addColumn("Employees", "shoe_size", { type: DataTypes.STRING(10) });
    await queryInterface.addColumn("Employees", "shirt_size", { type: DataTypes.STRING(10) });
    await queryInterface.addColumn("Employees", "pant_size", { type: DataTypes.STRING(10) });
  },
};
