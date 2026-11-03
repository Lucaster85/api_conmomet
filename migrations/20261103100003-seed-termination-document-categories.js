"use strict";

// Los nombres tienen que coincidir con helpers/terminationRules.js#TERMINATION_DOCUMENT_CATEGORIES
// (los avisos del egreso buscan la categoría por nombre). Se pueden renombrar desde el ABM de
// Categorías de Documento, pero entonces el aviso correspondiente deja de reconocerla.
const CATEGORIES = [
  "Telegrama de renuncia",
  "Telegrama / carta documento de despido",
  "Prueba",
  "Descargo del empleado",
  "Acta / escritura de mutuo acuerdo",
  "Acuerdo / convenio de pago",
  "Recibo de liquidación final firmado",
  "Certificado de trabajo (art. 80)",
  "Otro (egreso)",
];

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const now = new Date();
    for (const name of CATEGORIES) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM DocumentCategories WHERE name = :name AND applies_to = 'employee' AND deleted_at IS NULL LIMIT 1`,
        { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );
      if (!existing) {
        await queryInterface.bulkInsert("DocumentCategories", [
          {
            name,
            description: "Documentación del egreso del empleado.",
            applies_to: "employee",
            is_plant_specific: false,
            created_at: now,
            updated_at: now,
          },
        ]);
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("DocumentCategories", { name: CATEGORIES, applies_to: "employee" });
  },
};
