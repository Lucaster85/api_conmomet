"use strict";
// Corre UNA vez antes de toda la suite de integración (ver jest.config.js). Pinnea el entorno
// antes de requerir nada del código de producción, porque JWT_SECRET se congela en import-time
// (helpers/jwt.js:3) y la zona horaria tiene que coincidir con la que asume la lógica de
// negocio (quincenas, fechas DATEONLY) — setearlos en un beforeAll no tendría efecto.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-fixo-para-la-suite";
process.env.TZ = "America/Argentina/Buenos_Aires";

module.exports = async () => {
  const db = require("../../models");
  const { runSeed } = require("../../helpers/seed");

  try {
    await db.sequelize.authenticate();

    // Nivel 1 de la estrategia de truncate (ver test/setup/truncate.js): Permissions, Roles
    // de sistema, SystemSettings. Es el runSeed real — no un mock — para que la suite ejercite
    // exactamente lo que corre en producción al levantar el server.
    await runSeed(db);

    // Dos roles fijos para armar actores de test con permisos a medida (ver
    // test/helpers/auth.js#createActor). Se cuelgan los permisos del USUARIO, no del rol, así
    // que estos roles quedan sin permisos propios y nunca hace falta tocarlos entre tests.
    await db.Role.findOrCreate({
      where: { key: "test_role_custom" },
      defaults: { name: "Test Custom", key: "test_role_custom", level: 50, is_system: false },
    });
    await db.Role.findOrCreate({
      where: { key: "test_role_empty" },
      defaults: { name: "Test Empty", key: "test_role_empty", level: 10, is_system: false },
    });
  } finally {
    await db.sequelize.close();
  }
};
