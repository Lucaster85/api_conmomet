"use strict";
const { DataTypes } = require("sequelize");

/**
 * Una OCA de grúa puede tener varios vehículos, cada uno con su propio valor de referencia por
 * cliente — se agrega vehicle_id (NULL para man_hours, obligatorio a nivel aplicación para
 * crane_hours) y el índice único pasa de (client_id, oca_type) a (client_id, oca_type, vehicle_id).
 *
 * Mismo problema de MySQL que 20260921100001: el índice único actual sostiene la FK de client_id,
 * así que hay que crear el compuesto nuevo antes de borrar el viejo. up() es idempotente por si
 * se reintenta después de un fallo a mitad de camino.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const table = await queryInterface.describeTable("OcaClientRates");
    if (!table.vehicle_id) {
      await queryInterface.addColumn("OcaClientRates", "vehicle_id", {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Vehicles", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }

    const indexes = await queryInterface.showIndex("OcaClientRates");
    const hasComposite = indexes.some((idx) => idx.name === "oca_client_rates_client_id_oca_type_vehicle_id");
    const hasOldComposite = indexes.some((idx) => idx.name === "oca_client_rates_client_id_oca_type");

    if (!hasComposite) {
      await queryInterface.addIndex("OcaClientRates", ["client_id", "oca_type", "vehicle_id"], { unique: true });
    }
    if (hasOldComposite) {
      await queryInterface.removeIndex("OcaClientRates", ["client_id", "oca_type"]);
    }
  },
  async down(queryInterface) {
    const indexes = await queryInterface.showIndex("OcaClientRates");
    const hasOldComposite = indexes.some((idx) => idx.name === "oca_client_rates_client_id_oca_type");
    const hasComposite = indexes.some((idx) => idx.name === "oca_client_rates_client_id_oca_type_vehicle_id");

    if (!hasOldComposite) {
      await queryInterface.addIndex("OcaClientRates", ["client_id", "oca_type"], { unique: true });
    }
    if (hasComposite) {
      await queryInterface.removeIndex("OcaClientRates", ["client_id", "oca_type", "vehicle_id"]);
    }
    await queryInterface.removeColumn("OcaClientRates", "vehicle_id");
  },
};
