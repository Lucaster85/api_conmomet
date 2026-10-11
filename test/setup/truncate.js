"use strict";
// Aislamiento entre tests de integración: TRUNCATE de todo menos el "nivel 1" (referencia,
// sembrado una sola vez por runSeed en globalSetup). Nunca DELETE FROM — en una tabla vacía es
// instantáneo, y a diferencia de DELETE reinicia el auto_increment, así que los ids son
// predecibles test a test.
//
// Nivel 1 — no se trunca nunca: Permissions, Roles, SystemSettings (sembrados por runSeed en
// globalSetup) + role_permission (los permisos del ROL admin, asignados una sola vez en el
// seed). Users y user_permission SÍ se truncan (nivel 2): cada test mintea sus propios actores.
//
// Se suman acá tres catálogos que NO vienen de runSeed sino de migraciones con bulkInsert
// incondicional (corren una sola vez al migrar, no en cada boot) — truncarlos los deja vacíos
// para el resto de la suite, sin que nada los repueble:
// - Providers: la fila `is_system` ("Sin especificar") es la que usa
//   materialPriceService.js#getUnspecifiedProvider para cualquier línea de material sin
//   proveedor explícito. Sin ella, esa función explota con "Corra las migraciones pendientes."
// - BudgetItemTypes y MaterialUnits: catálogos base (rubros, unidades) que la migración
//   original sembró como dato de referencia del deploy, no como fixture de test.
const db = require("../../models");

const NEVER_TRUNCATE = new Set([
  "SequelizeMeta",
  "Permissions",
  "Roles",
  "SystemSettings",
  "role_permission",
  "Providers",
  "BudgetItemTypes",
  "MaterialUnits",
]);

let cachedTables = null;

async function getTruncatableTables() {
  if (cachedTables) return cachedTables;
  const [rows] = await db.sequelize.query(
    "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  cachedTables = rows.map((r) => r.name).filter((name) => !NEVER_TRUNCATE.has(name));
  return cachedTables;
}

afterEach(async () => {
  const tables = await getTruncatableTables();
  await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const table of tables) {
      await db.sequelize.query(`TRUNCATE TABLE \`${table}\``);
    }
  } finally {
    await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
  }
});

afterAll(async () => {
  await db.sequelize.close();
});
