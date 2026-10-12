"use strict";

/**
 * Pasa los descartes que ya existían en SalaryAdvanceDeletionAlerts.dismissed_by (array JSON de
 * user ids, el mecanismo ad-hoc que tenía solo ese aviso) a filas de UserAlertViews, para que
 * nadie vea reaparecer un aviso que ya había descartado al migrar al mecanismo unificado
 * (ver FLOWS.md flujo 36).
 *
 * `revision` fija en "1": el registro de un adelanto anulado es inmutable, nunca cambia nada que
 * justifique volver a mostrarlo.
 *
 * La columna `dismissed_by` NO se dropea: dejarla permite volver atrás sin perder datos, y la
 * tabla es chica. Queda marcada como deprecada en models/salaryAdvanceDeletionAlert.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const [rows] = await queryInterface.sequelize.query(
      "SELECT id, dismissed_by FROM SalaryAdvanceDeletionAlerts WHERE dismissed_by IS NOT NULL"
    );

    const views = [];
    for (const row of rows) {
      // MySQL puede devolver la columna JSON ya parseada o como string, según driver/versión.
      let dismissed = row.dismissed_by;
      if (typeof dismissed === "string") {
        try {
          dismissed = JSON.parse(dismissed);
        } catch {
          dismissed = [];
        }
      }
      if (!Array.isArray(dismissed)) continue;

      for (const userId of dismissed) {
        if (!Number.isInteger(Number(userId))) continue;
        views.push({
          user_id: Number(userId),
          alert_type: "salary_advance_deletion",
          entity_id: row.id,
          revision: "1",
          seen_at: Sequelize.literal("CURRENT_TIMESTAMP"),
          created_at: Sequelize.literal("CURRENT_TIMESTAMP"),
          updated_at: Sequelize.literal("CURRENT_TIMESTAMP"),
        });
      }
    }

    if (views.length > 0) {
      // ignoreDuplicates: si la migración se re-corre sobre una base donde ya se insertaron,
      // el índice único no debe tumbar el arranque del container.
      await queryInterface.bulkInsert("UserAlertViews", views, { ignoreDuplicates: true });
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("UserAlertViews", { alert_type: "salary_advance_deletion" });
  },
};
