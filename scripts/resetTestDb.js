"use strict";
// Reconstruye la base de datos de test desde cero, a partir de las migraciones (nunca
// sequelize.sync(): el schema real vive en migrations/, y queremos ejercitar exactamente eso).
// Pega contra la MISMA instancia local de MySQL que usa `npm run dev` (brew, 127.0.0.1:3306),
// pero en una base separada (LOCAL_TEST_DATABASE_URL) — no requiere Docker.
//
// Guard de host: si LOCAL_TEST_DATABASE_URL no apunta a localhost, aborta sin tocar nada. Es
// lo único que impide que un NODE_ENV=test perdido corra DROP DATABASE contra un host remoto
// (p. ej. staging — ver DATABASE_URL_STAGING en .env.example, que es un nombre distinto a
// propósito para que nadie lo confunda con este).
//
// Guard extra, por compartir servidor con la base de desarrollo: si el nombre de la base de
// test coincidiera con DATABASE_NAME (la de dev), también aborta — un DROP DATABASE ahí sería
// irreversible.
require("dotenv").config();
const { execSync } = require("child_process");
const mysql = require("mysql2/promise");

const ALLOWED_HOSTS = ["127.0.0.1", "localhost", "::1"];

async function main() {
  const rawUrl = process.env.LOCAL_TEST_DATABASE_URL;
  if (!rawUrl) {
    console.error("[resetTestDb] Falta LOCAL_TEST_DATABASE_URL en el entorno.");
    process.exit(1);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    console.error("[resetTestDb] LOCAL_TEST_DATABASE_URL no es una URL válida.");
    process.exit(1);
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    console.error(
      `[resetTestDb] LOCAL_TEST_DATABASE_URL apunta a "${parsed.hostname}", que no está en la ` +
      `allowlist (${ALLOWED_HOSTS.join(", ")}). Este script hace DROP DATABASE: nunca contra ` +
      `un host remoto. Abortando.`
    );
    process.exit(1);
  }

  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    console.error("[resetTestDb] LOCAL_TEST_DATABASE_URL no especifica un nombre de base.");
    process.exit(1);
  }

  if (process.env.DATABASE_NAME && database === process.env.DATABASE_NAME) {
    console.error(
      `[resetTestDb] LOCAL_TEST_DATABASE_URL apunta a "${database}", que es el mismo nombre que ` +
      `DATABASE_NAME (la base de desarrollo). Abortando antes de hacer DROP DATABASE sobre ella.`
    );
    process.exit(1);
  }

  const connection = await mysql.createConnection({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username || "root"),
    password: decodeURIComponent(parsed.password || ""),
  });

  try {
    console.log(`[resetTestDb] DROP + CREATE DATABASE \`${database}\` en ${parsed.hostname}:${parsed.port || 3306}...`);
    await connection.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await connection.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await connection.end();
  }

  console.log("[resetTestDb] Corriendo migraciones (--env test)...");
  execSync("npx sequelize-cli db:migrate --env test", { stdio: "inherit", cwd: __dirname + "/.." });

  console.log("[resetTestDb] Listo.");
}

main().catch((error) => {
  console.error("[resetTestDb] Error:", error.message);
  process.exit(1);
});
