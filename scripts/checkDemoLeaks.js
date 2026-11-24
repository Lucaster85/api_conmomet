"use strict";
// Busca en TODAS las columnas de texto y JSON de la base local los valores reales que anonymizeDemo.js registró en
// .demo-blacklist.local.json (CUIT, DNI, CBU, emails, teléfonos, nombres de clientes/proveedores/plantas/proyectos, apellidos…).
// Es SOLO LECTURA. Resultado esperado: 0 coincidencias. El reporte enmascara los valores (no imprime datos reales).
//
//   node scripts/checkDemoLeaks.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const BLACKLIST_FILE = path.join(__dirname, "..", ".demo-blacklist.local.json");
const ALLOWED_HOSTS = ["127.0.0.1", "localhost", "::1"];
const TEXT_TYPES = ["varchar", "char", "tinytext", "text", "mediumtext", "longtext", "json"];

const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mask = (term) => `${term.slice(0, 2)}${"*".repeat(Math.max(term.length - 2, 1))} (${term.length} car.)`;
function die(message) { console.error(`\n[checkDemoLeaks] ${message}\n`); process.exit(1); }

async function main() {
  const cfg = require("../config/config.js").development;
  if ((process.env.NODE_ENV || "").toLowerCase() === "production") die("NODE_ENV=production: no corre en producción.");
  if (!ALLOWED_HOSTS.includes(cfg.host)) die(`DATABASE_HOST="${cfg.host}" no es local.`);
  if (!fs.existsSync(BLACKLIST_FILE)) die("No existe .demo-blacklist.local.json: se genera al correr anonymizeDemo.js (sin --dry-run).");
  const { terms } = JSON.parse(fs.readFileSync(BLACKLIST_FILE, "utf8"));
  if (!Array.isArray(terms) || !terms.length) die("La lista negra está vacía.");

  const folded = [...new Set(terms.map(fold))].sort((a, b) => b.length - a.length);
  const regex = new RegExp(folded.map(escapeRegex).join("|"), "g");
  const conn = await mysql.createConnection({ host: cfg.host, user: cfg.username, password: cfg.password, database: cfg.database });
  const cols = (await conn.query(
    `SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE IN (${TEXT_TYPES.map(() => "?").join(",")}) AND TABLE_NAME NOT IN ('SequelizeMeta','_DemoAnonymized') ORDER BY TABLE_NAME, COLUMN_NAME`,
    TEXT_TYPES
  ))[0];

  const publicUrl = process.env.STORAGE_PUBLIC_URL ? fold(process.env.STORAGE_PUBLIC_URL) : null;
  const findings = [];
  let scanned = 0;
  for (const { t, c } of cols) {
    const rows = (await conn.query(`SELECT DISTINCT \`${c}\` v FROM \`${t}\` WHERE \`${c}\` IS NOT NULL`))[0];
    for (const { v } of rows) {
      const text = fold(typeof v === "string" ? v : JSON.stringify(v));
      scanned++;
      const hits = new Set(text.match(regex) || []);
      for (const hit of hits) findings.push({ where: `${t}.${c}`, what: mask(hit) });
      if (publicUrl && text.includes(publicUrl) && !text.includes("demo/")) findings.push({ where: `${t}.${c}`, what: "referencia a archivo fuera de demo/" });
    }
  }
  await conn.end();

  console.log(`[checkDemoLeaks] ${cols.length} columnas, ${scanned} valores distintos revisados, ${folded.length} términos reales.`);
  if (!findings.length) {
    console.log("[checkDemoLeaks] ✔ 0 coincidencias. No se encontró ningún valor real de la lista negra.");
    return;
  }
  const grouped = new Map();
  for (const f of findings) { const key = `${f.where}  →  ${f.what}`; grouped.set(key, (grouped.get(key) || 0) + 1); }
  console.log(`[checkDemoLeaks] ✖ ${findings.length} coincidencias:`);
  for (const [key, n] of grouped) console.log(`  ${key}${n > 1 ? `  (x${n})` : ""}`);
  process.exitCode = 1;
}

main().catch((error) => die(error.stack || error.message));
