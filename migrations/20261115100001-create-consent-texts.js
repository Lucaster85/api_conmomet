"use strict";
const { DataTypes } = require("sequelize");

// El texto que estaba escrito en la página "Trabajá con nosotros" antes de que fuera editable: queda como
// versión 1, así el comportamiento no cambia al migrar y los postulantes ya cargados (que aceptaron ese texto)
// quedan apuntando a una versión que existe.
const INITIAL_TEXT = [
  "Responsable: Conmomet S.A. Usamos los datos que nos enviás (incluidos tu DNI y tu CV) únicamente para evaluar tu postulación y para contactarte por búsquedas laborales de la empresa.",
  "Quién los ve: solo el personal de la empresa que se ocupa de las contrataciones. No los cedemos a terceros.",
  "Por cuánto tiempo: los conservamos mientras sean necesarios para evaluar tu postulación y futuras búsquedas, o hasta que nos pidas que los eliminemos.",
  "Tus derechos: podés pedirnos acceso, rectificación o supresión de tus datos escribiendo a montajes@conmomet.com.ar. Según la Ley 25.326 el titular puede ejercer el derecho de acceso en forma gratuita a intervalos no inferiores a seis meses, y la Agencia de Acceso a la Información Pública, órgano de control de esa ley, atiende las denuncias y reclamos por incumplimientos.",
].join("\n\n");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("ConsentTexts", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      kind: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "job_application" },
      version: { type: DataTypes.INTEGER, allowNull: false },
      content: { type: DataTypes.TEXT, allowNull: false },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
    });
    await queryInterface.addIndex("ConsentTexts", ["kind", "version"], { unique: true, name: "consent_texts_kind_version_unique" });

    const now = new Date();
    await queryInterface.bulkInsert("ConsentTexts", [
      { kind: "job_application", version: 1, content: INITIAL_TEXT, created_by: null, created_at: now, updated_at: now },
    ]);

    // Antes la versión era la constante "2026-11"; ahora es el número de ConsentTexts.version.
    await queryInterface.sequelize.query("UPDATE Candidates SET consent_version = '1' WHERE consent_version = '2026-11'");
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query("UPDATE Candidates SET consent_version = '2026-11' WHERE consent_version = '1'");
    await queryInterface.dropTable("ConsentTexts");
  },
};
