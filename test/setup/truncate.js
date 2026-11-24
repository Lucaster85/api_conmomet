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
  "CompanyProfiles",
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

/**
 * Tablas que el test dejó "sucias": las que tienen filas y las que tuvieron altas aunque hoy estén vacías (su AUTO_INCREMENT quedó pasado de 1: sin truncarlas, los ids
 * de un test dependerían de los anteriores). Truncar las ~100 tablas en cada test tardaba ~0,3 s por test; un test típico toca 5 o 10. La consulta es una sola ida a la
 * base. `information_schema_stats_expiry = 0` (por sesión) evita el caché de estadísticas de MySQL 8 (por defecto, un día), que mostraría un AUTO_INCREMENT viejo.
 */
async function getDirtyTables() {
  const tables = await getTruncatableTables();
  const withRows = `SELECT name FROM (${tables.map((t) => `SELECT '${t}' AS name FROM DUAL WHERE EXISTS (SELECT 1 FROM \`${t}\`)`).join(" UNION ALL ")}) AS t`;
  const [rows] = await db.sequelize.query(withRows);
  // En una transacción para que el SET SESSION y la consulta vayan por la MISMA conexión del pool.
  const counters = await db.sequelize.transaction(async (transaction) => {
    await db.sequelize.query("SET SESSION information_schema_stats_expiry = 0", { transaction });
    const [found] = await db.sequelize.query(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND AUTO_INCREMENT > 1",
      { transaction }
    );
    return found;
  });
  const dirty = new Set([...rows.map((r) => r.name), ...counters.map((r) => r.name)]);
  return tables.filter((table) => dirty.has(table));
}

afterEach(async () => {
  const dirty = await getDirtyTables();
  if (dirty.length === 0) return;
  await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const table of dirty) {
      await db.sequelize.query(`TRUNCATE TABLE \`${table}\``);
    }
  } finally {
    await db.sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
  }
});

afterAll(async () => {
  await db.sequelize.close();
});
