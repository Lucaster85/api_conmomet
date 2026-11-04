"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // Cuándo se le avisó al dueño que la nota venció (ver services/expirationNotifier.js#syncQuickNotes
    // y FLOWS.md §48, etapa 3). null = todavía no se avisó.
    //
    // Va en la nota y no se deduplica contra Notifications (como los documentos y el EPP) a propósito:
    // un documento avisa una vez por tipo y por destinatario, pero una nota tiene UN solo destinatario
    // y su vencimiento es editable — al cambiar la fecha se vuelve a null y la nota puede avisar de nuevo.
    await queryInterface.addColumn("QuickNotes", "due_notified_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn("QuickNotes", "due_notified_at");
  },
};
