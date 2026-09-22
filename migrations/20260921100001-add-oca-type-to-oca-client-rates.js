"use strict";
const { DataTypes } = require("sequelize");

/**
 * Generaliza OcaClientRate para que un mismo cliente pueda tener un valor de referencia distinto
 * por tipo de OCA (man_hours vs crane_hours) — hasta ahora el índice único era solo sobre
 * client_id. La tabla está vacía en producción (el feature de horas hombre recién se está por
 * desplegar), pero en local/test puede haber filas de prueba ya cargadas — todas de man_hours,
 * único tipo que existía hasta ahora — así que se agrega nullable, se rellena y recién después
 * se pasa a NOT NULL, en vez de asumir la tabla vacía.
 *
 * MySQL no permite borrar el índice único de client_id mientras sea el único que sostiene la FK
 * hacia Clients — hay que crear el índice compuesto nuevo primero y recién después borrar el
 * viejo (en down() es al revés). up() además es idempotente: si se reintenta después de un
 * fallo a mitad de camino (por ejemplo, quedó agregada la columna pero no se llegó a tocar los
 * índices), no vuelve a intentar los pasos que ya se aplicaron.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable("OcaClientRates");

    if (!table.oca_type) {
      await queryInterface.addColumn("OcaClientRates", "oca_type", {
        type: DataTypes.ENUM("man_hours", "crane_hours"),
        allowNull: true,
      });
      await queryInterface.sequelize.query('UPDATE `OcaClientRates` SET `oca_type` = \'man_hours\' WHERE `oca_type` IS NULL;');
      await queryInterface.changeColumn("OcaClientRates", "oca_type", {
        type: DataTypes.ENUM("man_hours", "crane_hours"),
        allowNull: false,
      });
    } else if (table.oca_type.allowNull) {
      await queryInterface.sequelize.query('UPDATE `OcaClientRates` SET `oca_type` = \'man_hours\' WHERE `oca_type` IS NULL;');
      await queryInterface.changeColumn("OcaClientRates", "oca_type", {
        type: DataTypes.ENUM("man_hours", "crane_hours"),
        allowNull: false,
      });
    }

    const indexes = await queryInterface.showIndex("OcaClientRates");
    const hasComposite = indexes.some((idx) => idx.name === "oca_client_rates_client_id_oca_type");
    const hasOldUnique = indexes.some((idx) => idx.name === "oca_client_rates_client_id");

    if (!hasComposite) {
      await queryInterface.addIndex("OcaClientRates", ["client_id", "oca_type"], { unique: true });
    }
    if (hasOldUnique) {
      await queryInterface.removeIndex("OcaClientRates", ["client_id"]);
    }
  },
  async down(queryInterface) {
    const indexes = await queryInterface.showIndex("OcaClientRates");
    const hasOldUnique = indexes.some((idx) => idx.name === "oca_client_rates_client_id");
    const hasComposite = indexes.some((idx) => idx.name === "oca_client_rates_client_id_oca_type");

    if (!hasOldUnique) {
      await queryInterface.addIndex("OcaClientRates", ["client_id"], { unique: true });
    }
    if (hasComposite) {
      await queryInterface.removeIndex("OcaClientRates", ["client_id", "oca_type"]);
    }
    await queryInterface.removeColumn("OcaClientRates", "oca_type");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_OcaClientRates_oca_type";');
  },
};
