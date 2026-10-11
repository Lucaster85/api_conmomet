require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASS,
    database: process.env.DATABASE_NAME,
    host: process.env.DATABASE_HOST,
    dialect: "mysql",
    timezone: "-03:00"
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: "mysql",
    timezone: "-03:00"
  },
  test: {
    // LOCAL_TEST_DATABASE_URL, no DATABASE_URL_TEST: ese nombre ya lo usaba el .env de cada
    // dev para guardar la URL de STAGING (el ambiente de Railway que deployea `develop`), sin
    // relación con este bloque "test" de sequelize-cli — iba a confundirse con esto.
    //
    // `get` en vez de un valor directo: el objeto completo se evalúa al hacer `require()` de
    // este módulo sin importar qué entorno se vaya a usar, así que un throw acá adentro (en vez
    // de en un getter) rompería `npm run dev` aunque LOCAL_TEST_DATABASE_URL nunca se use. Con
    // `get`, el fail-fast solo dispara si algo de verdad lee `config.test.url` (sequelize-cli
    // --env test, o config/sequelize.js con NODE_ENV=test).
    get url() {
      if (!process.env.LOCAL_TEST_DATABASE_URL) {
        throw new Error("Falta LOCAL_TEST_DATABASE_URL — ver .env.example y api_conmomet/CLAUDE.md.");
      }
      return process.env.LOCAL_TEST_DATABASE_URL;
    },
    dialect: "mysql",
    timezone: "-03:00",
    // Sin esto, cada query de la suite se imprime en stdout y sepulta la salida de Jest.
    logging: false,
  }
}
