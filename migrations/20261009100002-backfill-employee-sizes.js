"use strict";

/**
 * Paso 1 de 2 para dar de baja shoe_size/shirt_size/pant_size de Employees: copia esos tres
 * talles básicos a EmployeeSizes, asociados al artículo del catálogo que les corresponde por
 * nombre ("Botín de Seguridad", "Camiseta de Trabajo", "Pantalón de Trabajo" — los mismos del
 * seeder 20260428000001-seed-epp-items.js). El paso 2 (eliminar las columnas de Employees y el
 * código que las usa) se hace en una migración aparte, después de confirmar en la plataforma
 * que estos datos migraron bien — ver EmployeeSizesPanel en el legajo de cualquier empleado.
 *
 * No asume que el catálogo ya tiene estos 3 artículos: distintos entornos (local/test/prod)
 * pueden o no haber corrido el seeder original, así que si no se encuentra el artículo por
 * nombre, esta misma migración lo crea con los datos del seeder (categoría + tipo de talle) en
 * vez de omitir la columna.
 *
 * Por SQL crudo a propósito, sin pasar por los modelos Sequelize: Employee es `paranoid`, así
 * que un `Employee.findAll()` del ORM NO traería los empleados dados de baja (soft-deleted) y
 * se perderían sus talles.
 *
 * Idempotente: el `NOT EXISTS` hace que correrla de nuevo no inserte duplicados en
 * EmployeeSizes (además el índice único lo impediría de todos modos), y la búsqueda por nombre
 * antes de crear evita duplicar el artículo del catálogo.
 */

const COLUMN_TO_ITEM = {
  shoe_size: { name: "Botín de Seguridad", category: "footwear", size_type: "numeric" },
  shirt_size: { name: "Camiseta de Trabajo", category: "clothing", size_type: "alpha" },
  pant_size: { name: "Pantalón de Trabajo", category: "clothing", size_type: "alpha" },
};

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    for (const [column, { name, category, size_type }] of Object.entries(COLUMN_TO_ITEM)) {
      let [item] = await queryInterface.sequelize.query(
        `SELECT id FROM EppItems WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
        { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
      );

      if (!item) {
        const now = new Date();
        await queryInterface.bulkInsert("EppItems", [
          { name, category, size_type, is_active: true, created_at: now, updated_at: now },
        ]);
        [item] = await queryInterface.sequelize.query(
          `SELECT id FROM EppItems WHERE name = :name AND deleted_at IS NULL LIMIT 1`,
          { replacements: { name }, type: queryInterface.sequelize.QueryTypes.SELECT }
        );
        console.warn(`[backfill-employee-sizes] "${name}" no existía en EppItems — se creó (id ${item.id}) para poder asociar la columna "${column}".`);
      }

      await queryInterface.sequelize.query(
        `INSERT INTO EmployeeSizes (employee_id, epp_item_id, size, created_at, updated_at)
         SELECT e.id, :itemId, e.${column}, NOW(), NOW()
         FROM Employees e
         WHERE e.${column} IS NOT NULL AND e.${column} != ''
           AND NOT EXISTS (
             SELECT 1 FROM EmployeeSizes es WHERE es.employee_id = e.id AND es.epp_item_id = :itemId
           )`,
        { replacements: { itemId: item.id } }
      );
    }
  },

  // Best-effort y asimétrico a propósito. Borra las filas de EmployeeSizes para estos 3
  // artículos (si alguien editó a mano uno de esos talles después del backfill, el UPDATE pisó
  // la misma fila por el índice único — no hay forma de distinguir "vino del backfill" de "se
  // editó después", así que revertir borra el talle actual, no solo el valor original).
  // NO borra los EppItems que esta migración haya creado: no hay forma confiable de saber si
  // el artículo ya existía de antes en este entorno o si lo creamos nosotros, y borrar un
  // artículo de catálogo que ya tenía entregas asociadas sería mucho más destructivo que dejar
  // una fila de catálogo de más.
  async down(queryInterface) {
    const names = Object.values(COLUMN_TO_ITEM).map((i) => i.name);
    const items = await queryInterface.sequelize.query(
      `SELECT id FROM EppItems WHERE name IN (:names)`,
      { replacements: { names }, type: queryInterface.sequelize.QueryTypes.SELECT }
    );
    const ids = items.map((i) => i.id);
    if (ids.length > 0) {
      await queryInterface.bulkDelete("EmployeeSizes", { epp_item_id: ids });
    }
  },
};
