"use strict";
const { DataTypes } = require("sequelize");

/**
 * Marca de cuándo corrió por última vez el barrido de vencimientos
 * (services/expirationNotifier.js, ver FLOWS.md flujo 38).
 *
 * Vive en SystemSettings (fila única, id 1) porque tiene que ser compartida entre procesos: el
 * UPDATE condicional sobre esta columna es a la vez el throttle (no barrer en cada request) y el
 * lock (dos instancias no barren en paralelo). Una variable en memoria no serviría para lo
 * segundo.
 *
 * Mismo patrón que documenta models/systemSetting.js: un parámetro nuevo es una columna nueva,
 * no un esquema key-value.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addColumn("SystemSettings", "last_expiration_sync_at", {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Última corrida del barrido de vencimientos; NULL = nunca corrió",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("SystemSettings", "last_expiration_sync_at");
  },
};
