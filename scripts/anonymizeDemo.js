"use strict";
// Anonimiza la base de datos LOCAL de desarrollo para armar un entorno de demo. Ver el plan "Entorno de demo con datos
// anonimizados". Pisa la base: lo que no sea reversible se recupera SOLO desde el backup (.sql) que se exige por argumento.
//
//   node scripts/anonymizeDemo.js --dry-run                       # corre todo adentro de una transacción y hace ROLLBACK
//   node scripts/anonymizeDemo.js --confirm --cuit=30XXXXXXXXX --backup=/ruta/backup.sql
//
// Opciones: --skip-files (no toca R2 y deja las referencias a archivos como están: NO usar para la demo real).
//
// Qué hace, en orden (todo en UNA transacción; R2 va antes del COMMIT, así que si falla se revierte la base):
//   1. Vacía tablas sin valor para la demo o con fuga indirecta (auditoría, avisos, postulantes, snapshots JSON).
//   2. Reemplaza identidades (usuarios, empleados, clientes, proveedores, empresa, CBU, plantas, proyectos…).
//   3. Borra el texto libre (notas, motivos…) y "scrubea" las descripciones que se conservan.
//   4. Reescribe los JSON de las facturas (snapshots de emisor/receptor, resultado de ARCA).
//   5. Achica todos los montos con un factor global secreto (nunca se guarda ni se imprime).
//   6. Reapunta cada referencia a archivo a una copia de un placeholder dentro del bucket STORAGE_BUCKET_DEMO.
//
// FAIL-CLOSED: si la base tiene una columna de texto/JSON/decimal que este script no clasificó (por ejemplo, una migración
// nueva), aborta y la lista. Así una columna nueva nunca se cuela sin revisar.
//
// Nunca toca DATABASE_URL / DATABASE_URL_DEMO / DATABASE_URL__STAGING: usa solo DATABASE_HOST/USER/PASS/NAME (la base de
// dev) y exige que el host sea local.
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const PDFDocument = require("pdfkit");
const { isValidCuit } = require("../helpers/cuit");
const { isValidCbu } = require("../helpers/cbu");

const ROOT = path.join(__dirname, "..");
const BLACKLIST_FILE = path.join(ROOT, ".demo-blacklist.local.json");
const CREDENTIALS_FILE = path.join(ROOT, "demo-credentials.local.md");
const ALLOWED_HOSTS = ["127.0.0.1", "localhost", "::1"];
const MARKER_TABLE = "_DemoAnonymized";

// ─────────────────────────────────────────────────────────────── argumentos
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const DRY_RUN = flag("dry-run");
const SKIP_FILES = flag("skip-files");
const CONFIRM = flag("confirm");
const DEMO_CUIT = opt("cuit");
const BACKUP_PATH = opt("backup");

function die(message) {
  console.error(`\n[anonymizeDemo] ${message}\n`);
  process.exit(1);
}
const log = (...parts) => console.log("[anonymizeDemo]", ...parts);

// ─────────────────────────────────────────────────────────────── clasificación de columnas
// Tablas que se vacían enteras (DELETE; el AUTO_INCREMENT no importa).
const WIPE_TABLES = [
  "AuditLogs", "EditSessions", "Notifications", "PushSubscriptions", "UserAlertViews", "QuickNotes",
  "EmployeeInvitations", "ArcaTokens", "ArcaSequences", "ContactInquiries",
  "CandidateApplicationLogs", "CandidateInterviews", "candidate_interview_interviewer", "CandidateFiles",
  "CandidateApplications", "Candidates", "LoanChangeAlerts", "SalaryAdvanceDeletionAlerts",
];

// Columnas de dinero (se escalan) y decimales que NO son dinero (horas, cantidades, porcentajes, cotizaciones).
const MONEY = {
  BudgetLaborLines: ["unit_price", "estimated_total"],
  BudgetMaterialItems: ["unit_price", "total_price", "material_cost_snapshot"],
  Categories: ["guild_hourly_rate"],
  ClientItemRates: ["current_rate"],
  ClientItemRateHistories: ["rate"],
  ClientPurchaseOrders: ["amount"],
  ClientPurchaseOrderItems: ["amount"],
  Employees: ["hourly_rate", "monthly_salary"],
  EmployeeRates: ["rate", "guild_rate", "extras_rate"],
  EmployeeTerminations: ["cct_cap_amount", "debt_resolved_amount"],
  EmployerCosts: ["amount"],
  Invoices: ["net_amount", "iva_amount", "total_amount", "total_amount_ars", "exchange_diff_base_usd", "fce_balance", "fce_accepted_balance"],
  InvoiceLines: ["adjustment_base_amount", "net_amount", "base_gross_amount", "base_net_amount"],
  Loans: ["amount", "requested_amount", "installment_amount", "amount_ars_at_origin", "remaining_balance"],
  LoanInstallments: ["principal_amount", "interest_amount", "total_amount", "remaining_principal_after"],
  LoanInterestApplications: ["capital_before", "interest_amount", "capital_after"],
  LoanPayments: ["amount", "amount_ars"],
  MaterialCostHistories: ["cost"],
  MaterialProviderPrices: ["cost"],
  Ocas: ["hourly_rate"],
  OcaClientRates: ["hourly_rate"],
  OcaClientRateHistories: ["hourly_rate"],
  OcaLines: ["hourly_rate"],
  PayrollAdjustments: ["amount"],
  PayrollEntries: ["regular_amount", "overtime_50_amount", "overtime_100_amount", "gross_amount", "advances_deducted", "loan_installments_deducted", "net_amount"],
  PayrollLines: ["rate", "subtotal", "suggested_amount"],
  SalaryAdvances: ["amount", "requested_amount"],
  SalaryHistories: ["previous_value", "new_value"],
  SuretyBonds: ["amount"],
  SystemSettings: ["max_loan_amount_ars"],
  TerminationAgreements: ["total_amount"],
  TerminationAgreementInstallments: ["amount"],
};
const NON_MONEY = {
  Attendances: ["hours"],
  Budgets: ["labor_discount_percent", "material_discount_percent"],
  BudgetLaborLines: ["quantity", "hours_per_day"],
  BudgetMaterialItems: ["quantity", "margin_percent"],
  BudgetProgressEntries: ["percent"],
  Invoices: ["exchange_rate", "iva_rate", "exchange_diff_base_rate", "exchange_diff_new_rate"],
  InvoiceLines: ["adjustment_percent", "percent", "base_discount_percent"],
  Loans: ["interest_rate_percent", "monthly_interest_percent", "exchange_rate_at_origin"],
  LoanInterestApplications: ["rate_percent_used"],
  LoanPayments: ["exchange_rate"],
  Materials: ["kg_per_meter"],
  OcaLines: ["regular_hours", "overtime_50_hours", "overtime_100_hours"],
  OcaMaterialItems: ["quantity"],
  PayPeriods: ["usd_exchange_rate"],
  PayrollEntries: ["total_regular_hours", "total_overtime_50_hours", "total_overtime_100_hours"],
  PayrollLines: ["quantity"],
  ProjectHourBudgets: ["budgeted_hours"],
  ProjectManualHours: ["hours"],
  RateChanges: ["percentage"],
  TimeEntries: ["regular_hours", "overtime_50_hours", "overtime_100_hours"],
};

// Referencias a archivos en R2: [tabla, slot, urlCol, keyCol, nameCol, tipo]. tipo: "doc" (según extensión) | "image" | "signature".
const FILE_GROUPS = [
  ["Attendances", "document", "document_url", "document_key", "document_name", "doc"],
  ["BudgetBillingFiles", "file", "file_url", "file_key", "file_name", "doc"],
  ["BudgetProgressEntryFiles", "file", "file_url", "file_key", "file_name", "doc"],
  ["ClientPurchaseOrderFiles", "file", "file_url", "file_key", "file_name", "doc"],
  ["EntityDocuments", "file", "file_url", "file_key", "file_name", "doc"],
  ["EmployerCosts", "file", "file_url", null, null, "doc"],
  ["Invoices", "file", "file_url", "file_key", "file_name", "doc"],
  ["Invoices", "payment", "payment_file_url", "payment_file_key", "payment_file_name", "doc"],
  ["LeaveRequests", "document", "document_url", "document_key", "document_name", "doc"],
  ["Loans", "payment", "payment_proof_url", "payment_proof_key", "payment_proof_name", "doc"],
  ["Loans", "signature", "signature_url", "signature_key", "signature_name", "signature"],
  ["Media", "media", "url", null, null, "image"],
  ["Ocas", "approved", "approved_img_url", null, null, "image"],
  ["Budgets", "approved", "approved_document_url", null, null, "doc"],
  ["PayrollEntries", "signature", "signature_url", "signature_key", "signature_name", "signature"],
  ["ProjectLogEntryFiles", "file", "file_url", "file_key", "file_name", "doc"],
  ["QuoteRequestFiles", "file", "file_url", "file_key", "file_name", "doc"],
  ["SafetyEquipments", "signature", "signature_url", "signature_key", "signature_name", "signature"],
  ["SalaryAdvances", "payment", "payment_proof_url", "payment_proof_key", "payment_proof_name", "doc"],
  ["SalaryAdvances", "signature", "signature_url", "signature_key", "signature_name", "signature"],
  ["SuretyBonds", "file", "file_url", "file_key", "file_name", "doc"],
  ["TerminationAgreementInstallments", "payment", "payment_proof_url", "payment_proof_key", "payment_proof_name", "doc"],
  ["TerminationAgreementInstallments", "signature", "signature_url", "signature_key", "signature_name", "signature"],
];
const FILE_AUX_COLS = { BudgetBillingFiles: ["mime_type"], BudgetProgressEntryFiles: ["mime_type"], ClientPurchaseOrderFiles: ["mime_type"], ProjectLogEntryFiles: ["mime_type"], QuoteRequestFiles: ["mime_type"], SuretyBonds: ["mime_type"] };

// Columnas de texto que este script reemplaza por completo (identidad).
const IDENT = {
  Users: ["name", "lastname", "password", "email", "cuit", "phone", "celphone"],
  Employees: ["name", "lastname", "dni", "cuil", "address", "phone", "email"],
  ClientSupervisors: ["name", "lastname", "email", "phone"],
  Clients: ["razon_social", "email", "phone", "cuit", "fiscal_street", "fiscal_locality", "fiscal_province"],
  Providers: ["razon_social", "email", "phone"],
  CompanyProfiles: ["legal_name", "display_name", "cuit", "address_street", "address_number", "address_locality", "address_province", "iibb_number", "email", "phone"],
  CompanyBankAccounts: ["cbu", "alias"],
  CompanyPointsOfSale: ["address", "usage_description"],
  Plants: ["name", "address"],
  Projects: ["code", "name"],
  Budgets: ["title", "work_order_number"],
  QuoteRequests: ["title", "client_quote_number"],
  ClientPurchaseOrders: ["number"],
  BudgetProgressEntries: ["certificate_number"],
  SuretyBonds: ["insurer", "policy_number"],
  EntityDocuments: ["title"],
  Vehicles: ["plate"],
  Invoices: ["cae", "recipient_doc_number", "remito_number", "commercial_reference", "arca_result", "fce_arca_snapshot", "fce_rejection_reasons", "issuer_snapshot", "manual_recipient", "recipient_snapshot"],
};

// Texto técnico o de catálogo, sin datos personales: se conserva tal cual.
const KEEP = {
  BudgetItemTypes: ["name", "unit_label"], Budgets: ["number"], Categories: ["name"], ClientPurchaseOrderItems: ["position"],
  CompanyBankAccounts: ["bank_name"], ConsentTexts: ["content", "kind"], DocumentCategories: ["name", "description"],
  EmployeeSizes: ["size"], EmployerCostCategories: ["code", "name"], Employees: ["position"], EppItems: ["name"],
  Guilds: ["code", "name"], Holidays: ["name"], Invoices: ["sale_condition"], MaterialUnits: ["label"],
  Media: ["description", "title"], OcaStatusLogs: ["from_status", "to_status"], Ocas: ["number"],
  PayrollConcepts: ["code", "name"], PayrollLines: ["item_key"], Permissions: ["name"], QuoteRequests: ["number"],
  QuoteRequestStatusLogs: ["event", "from_status", "to_status"], Roles: ["key", "name"], SafetyEquipments: ["size_delivered"],
  SalaryHistories: ["field_changed"], SystemSettings: ["invoice_iva_rates"],
  Tools: ["brand", "model", "name", "reference_code", "serial_number"], ToolStatusLogs: ["from_status", "to_status"],
  ToolTypes: ["name"], Vehicles: ["brand", "model"], VehicleStatusLogs: ["from_status", "to_status"],
};

// Descripciones que se conservan (dan realismo) pero se "scrubean": se reemplazan los nombres reales conocidos.
const SCRUB = {
  BudgetLaborLines: ["description"], BudgetMaterialItems: ["description"], ClientPurchaseOrderItems: ["description"],
  InvoiceLines: ["description"], Materials: ["description"], OcaLines: ["task"], OcaMaterialItems: ["description"],
  PayrollAdjustments: ["label"], PayrollLines: ["label"], ProjectManualHours: ["description"],
};

// Texto libre que se borra (NULL, o '' si la columna es NOT NULL).
const WIPE = {
  AssetAssignments: ["delivery_notes", "return_notes"], Attendances: ["notes"], BudgetBillingFiles: ["description"],
  BudgetLaborLines: ["notes"], BudgetMaterialItems: ["notes"], BudgetProgressEntries: ["notes"],
  Budgets: ["description", "notes", "rejection_reason"], ClientPurchaseOrders: ["adjustment_notes", "payment_terms", "rejection_reason"],
  EmployeeTerminations: ["cancellation_reason", "cause_description", "debt_resolution_notes", "notes"], Employees: ["notes"],
  EmployerCosts: ["notes"], EntityDocuments: ["notes"], Invoices: ["cancellation_reason", "notes"], LeaveRequests: ["notes"],
  LoanInterestApplications: ["notes"], LoanPayments: ["notes"], Loans: ["cancellation_reason", "notes", "rejection_reason"],
  OcaLines: ["notes"], OcaMaterialItems: ["notes"], Ocas: ["notes", "rejection_reason"], OcaStatusLogs: ["notes"],
  PayrollEntries: ["notes"], PayrollLines: ["edit_reason"], PlantRequirements: ["notes"], Plants: ["notes"],
  ProjectLogEntries: ["note"], ProjectManualHours: ["void_reason"], Projects: ["description", "notes"],
  QuoteRequests: ["description", "notes"], QuoteRequestStatusLogs: ["comment"], RateChanges: ["notes"],
  SafetyEquipments: ["notes"], SalaryAdvances: ["cancellation_reason", "notes", "rejection_reason"], SalaryHistories: ["notes"],
  SuretyBonds: ["notes"], TerminationAgreements: ["cancellation_reason", "notes"], TimeEntries: ["notes", "void_reason"],
  Tools: ["notes"], ToolStatusLogs: ["notes"], VehicleStatusLogs: ["notes"],
  WorkDayLogs: ["observations", "suspended_by", "suspension_reason"],
};

// ─────────────────────────────────────────────────────────────── generadores determinísticos
function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function rngFor(seedText) {
  let a = hashSeed(seedText);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pickFrom = (list, rnd) => list[Math.floor(rnd() * list.length)];
const digits = (n, rnd) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join("");

const FIRST_NAMES = ["Martín", "Lucía", "Carlos", "Sofía", "Diego", "Valentina", "Federico", "Camila", "Hernán", "Julieta", "Pablo", "Florencia", "Gustavo", "Mariana", "Sebastián", "Romina", "Nicolás", "Agustina", "Facundo", "Paula", "Matías", "Carolina", "Ramiro", "Natalia", "Leandro", "Silvana", "Tomás", "Verónica", "Emiliano", "Daniela", "Gonzalo", "Micaela", "Iván", "Rocío", "Maximiliano", "Belén", "Alejandro", "Cecilia", "Joaquín", "Marina"];
const LAST_NAMES = ["Almeida", "Benítez", "Cabrera", "Domínguez", "Escobar", "Fernández", "Giménez", "Herrera", "Ibarra", "Juárez", "Kowalski", "Luna", "Medina", "Navarro", "Ortega", "Paredes", "Quiroga", "Rojas", "Sosa", "Torres", "Ugarte", "Vega", "Whelan", "Ximénez", "Yáñez", "Zapata", "Acosta", "Bustos", "Correa", "Duarte", "Echeverría", "Funes", "Gallardo", "Heredia", "Insúa", "Lagos", "Maldonado", "Núñez", "Olivera", "Peralta"];
const COMPANY_NAMES = ["Industrias Delta S.A.", "Metalúrgica Norte S.R.L.", "Petroquímica Austral S.A.", "Siderúrgica del Plata S.A.", "Energía Pampeana S.A.", "Química Litoral S.R.L.", "Agroindustrias Sur S.A.", "Ingeniería Horizonte S.A.", "Cementos Andinos S.A.", "Papelera Río Grande S.A.", "Alimentos del Valle S.A.", "Refinería Costa Azul S.A.", "Termoeléctrica Central S.A.", "Plásticos Moderna S.R.L.", "Logística Mediterránea S.A.", "Fundición San Martín S.A.", "Tecnoplanta S.A.", "Aceros Patagónicos S.A.", "Biocombustibles Pampa S.A.", "Frigorífico Los Álamos S.A.", "Vidriera Nacional S.A.", "Textil Cordillera S.A.", "Gas y Servicios del Centro S.A.", "Compañía Minera Altiplano S.A.", "Astilleros del Paraná S.A.", "Cerámica Imperial S.R.L.", "Lácteos Serranos S.A.", "Automotriz Del Oeste S.A.", "Procesadora Atlántica S.A.", "Montes y Asociados S.R.L."];
const PLACE_NAMES = ["Norte", "Sur", "Costanera", "Industrial Este", "Las Palmas", "San Lorenzo", "Puerto Viejo", "Villa Esperanza", "Los Cardales", "El Retiro", "Campo Grande", "Punta Alta", "Lomas del Sol", "Altos del Valle", "Río Seco", "Monte Verde", "La Barranca", "Santa Rita", "Cerro Azul", "Playa Chica"];
const STREETS = ["Av. San Martín", "Belgrano", "Rivadavia", "Mitre", "Sarmiento", "Av. Libertador", "Moreno", "Urquiza", "Lavalle", "Alsina", "25 de Mayo", "Av. del Trabajo", "Colón", "Independencia", "Av. Industrial"];
const LOCALITIES = ["Rosario", "Campana", "Zárate", "Bahía Blanca", "La Plata", "Córdoba", "Neuquén", "San Nicolás", "Mendoza", "Tucumán", "Ensenada", "Lima", "Pilar", "Tandil", "Villa Constitución"];
const PROVINCES = ["Buenos Aires", "Santa Fe", "Córdoba", "Neuquén", "Mendoza", "Tucumán"];
const WORK_NAMES = ["Montaje de cañerías", "Mantenimiento general", "Ampliación de sector", "Parada de planta", "Obra civil complementaria", "Reemplazo de tanques", "Montaje estructural", "Tendido de bandejas", "Instalación de equipos", "Reparación de línea", "Adecuación de sala de bombas", "Montaje de skid", "Refuerzo estructural", "Traslado de equipos", "Soldadura y pruebas"];

const MULTIPLIERS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
function withVerifier(body10) {
  const sum = MULTIPLIERS.reduce((acc, m, i) => acc + m * Number(body10[i]), 0);
  const remainder = 11 - (sum % 11);
  if (remainder === 10) return null;
  return body10 + String(remainder === 11 ? 0 : remainder);
}
/** CUIT/CUIL válido (dígito verificador correcto). prefixes: ["20","27"] personas, ["30","33"] empresas. */
function makeCuit(prefixes, rnd) {
  for (let i = 0; i < 100; i++) {
    const candidate = withVerifier(pickFrom(prefixes, rnd) + digits(8, rnd));
    if (candidate && isValidCuit(candidate)) return candidate;
  }
  throw new Error("No se pudo generar un CUIT válido");
}
const dash = (cuit) => `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
function makeCbu(rnd) {
  for (let i = 0; i < 5000; i++) {
    const candidate = digits(22, rnd);
    if (isValidCbu(candidate)) return candidate;
  }
  throw new Error("No se pudo generar un CBU válido");
}

/** Reserva un valor único dentro de la corrida: si ya salió, el generador se vuelve a invocar. */
function uniqueValue(used, generate) {
  for (let i = 0; i < 1000; i++) {
    const value = generate(i);
    if (!used.has(value)) { used.add(value); return value; }
  }
  throw new Error("No se pudo generar un valor único");
}

// ─────────────────────────────────────────────────────────────── placeholders (PDF y PNG sin dependencias nuevas)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([length, typeBuf, data, crc]);
}
/** PNG en escala de grises con alfa. pixel(x, y) -> [gris, alfa]. */
function makePng(width, height, pixel) {
  const raw = Buffer.alloc((width * 2 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 2 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [gray, alpha] = pixel(x, y);
      raw[y * (width * 2 + 1) + 1 + x * 2] = gray;
      raw[y * (width * 2 + 1) + 2 + x * 2] = alpha;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 4;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))]);
}
function makeImagePng() {
  return makePng(480, 320, (x, y) => {
    const border = x < 6 || y < 6 || x >= 474 || y >= 314;
    const diagonal = Math.abs(x * 320 - y * 480) < 2400;
    return border || diagonal ? [150, 255] : [225, 255];
  });
}
function makeSignaturePng() {
  return makePng(300, 100, (x, y) => {
    const curve = 50 + 28 * Math.sin(x / 14) * Math.exp(-Math.abs(x - 150) / 140) + (x / 300) * 8;
    return Math.abs(y - curve) < 1.6 ? [20, 255] : [255, 0];
  });
}
function makePdf() {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 60 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(22).text("Documento de ejemplo", { align: "center" });
    doc.moveDown().fontSize(12).text("Este archivo es un marcador de posición del entorno de demostración. Podés reemplazarlo subiendo tu propio archivo de prueba.", { align: "left" });
    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────── seguridad
function assertSafeTarget() {
  if ((process.env.NODE_ENV || "").toLowerCase() === "production") die("NODE_ENV=production: este script nunca corre en producción.");
  const cfg = require("../config/config.js").development;
  if (!cfg.host || !cfg.database || !cfg.username) die("Faltan DATABASE_HOST / DATABASE_USER / DATABASE_NAME en el .env.");
  if (!ALLOWED_HOSTS.includes(cfg.host)) {
    die(`DATABASE_HOST="${cfg.host}" no es local (${ALLOWED_HOSTS.join(", ")}). Este script PISA la base: nunca contra un host remoto.`);
  }
  for (const name of ["DATABASE_URL", "DATABASE_URL_DEMO", "DATABASE_URL__STAGING", "LOCAL_TEST_DATABASE_URL"]) {
    const raw = process.env[name];
    if (!raw) continue;
    let parsed;
    try { parsed = new URL(raw); } catch { continue; }
    const sameHost = ALLOWED_HOSTS.includes(parsed.hostname);
    if (sameHost && parsed.pathname.replace(/^\//, "") === cfg.database) {
      die(`${name} apunta a la misma base local que DATABASE_NAME ("${cfg.database}"). Abortando.`);
    }
  }
  return cfg;
}

// ─────────────────────────────────────────────────────────────── principal
const TEXT_TYPES = new Set(["varchar", "char", "tinytext", "text", "mediumtext", "longtext", "json", "tinyblob", "blob", "mediumblob", "longblob"]);
const NUM_TYPES = new Set(["decimal", "float", "double"]);
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bt = (name) => `\`${name}\``;

async function main() {
  const cfg = assertSafeTarget();
  if (!DRY_RUN) {
    if (!CONFIRM) die("Falta --confirm (o usá --dry-run para ver qué haría sin guardar nada).");
    if (!DEMO_CUIT || !isValidCuit(DEMO_CUIT)) die("Falta --cuit=<11 dígitos> válido: el CUIT del certificado de homologación de ARCA de la demo.");
    if (!BACKUP_PATH) die("Falta --backup=<archivo .sql>: un backup de esta base, hecho ANTES de correr el script.");
    let stat;
    try { stat = fs.statSync(BACKUP_PATH); } catch { die(`No existe el backup "${BACKUP_PATH}".`); }
    if (!stat.isFile() || stat.size < 10 * 1024) die("El backup está vacío o es demasiado chico para ser un dump real.");
    if (path.resolve(BACKUP_PATH).startsWith(ROOT + path.sep)) die("El backup tiene que estar FUERA del repo (contiene datos reales).");
  }

  // Bucket demo: solo STORAGE_BUCKET_DEMO, nunca el de staging/prod.
  const bucket = process.env.STORAGE_BUCKET_DEMO;
  let s3 = null;
  let S3 = null;
  if (!SKIP_FILES) {
    if (!bucket) die("Falta STORAGE_BUCKET_DEMO en el .env.");
    if (bucket === process.env.STORAGE_BUCKET) die("STORAGE_BUCKET_DEMO es igual a STORAGE_BUCKET: el bucket de la demo tiene que ser otro.");
    if (!process.env.STORAGE_PUBLIC_URL) die("Falta STORAGE_PUBLIC_URL en el .env (se usa como prefijo de las referencias a archivos).");
    // Preferí un token de R2 propio de la demo (STORAGE_ACCESS_KEY_ID_DEMO / STORAGE_SECRET_ACCESS_KEY_DEMO) con permiso SOLO sobre
    // el bucket demo: es el mismo que va en Railway, y así la demo nunca puede tocar los archivos de staging/prod.
    const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID_DEMO || process.env.STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY_DEMO || process.env.STORAGE_SECRET_ACCESS_KEY;
    const endpoint = process.env.STORAGE_R2_ENDPOINT_DEMO || process.env.STORAGE_R2_ENDPOINT;
    if (!endpoint || !accessKeyId || !secretAccessKey) die("Faltan credenciales STORAGE_* en el .env.");
    S3 = require("@aws-sdk/client-s3");
    s3 = new S3.S3Client({ region: "auto", endpoint, credentials: { accessKeyId, secretAccessKey } });
    try {
      await s3.send(new S3.HeadBucketCommand({ Bucket: bucket }));
      log(`Bucket demo "${bucket}" accesible.`);
    } catch (error) {
      const message = `No se pudo acceder al bucket "${bucket}" (HTTP ${error.$metadata && error.$metadata.httpStatusCode}). El token de R2 no tiene permiso sobre ese bucket: creá uno con "Object Read & Write" sobre ${bucket} y ponelo en STORAGE_ACCESS_KEY_ID_DEMO / STORAGE_SECRET_ACCESS_KEY_DEMO.`;
      if (!DRY_RUN) die(message);
      log(`⚠ ${message}\n  (en --dry-run no se escribe en R2, así que se sigue; sin --dry-run esto aborta)`);
    }
  }

  const conn = await mysql.createConnection({ host: cfg.host, user: cfg.username, password: cfg.password, database: cfg.database });
  const q = async (sql, params) => (await conn.query(sql, params))[0];
  log(`Base: ${cfg.database} @ ${cfg.host}  ${DRY_RUN ? "(DRY-RUN: se hace ROLLBACK al final)" : "(se PISA)"}`);

  const [{ n: marked }] = await q("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", [MARKER_TABLE]);
  if (marked) die(`La base ya fue anonimizada (existe ${MARKER_TABLE}). Correrlo de nuevo escalaría los montos dos veces: restaurá el backup primero.`);

  // ── catálogo de columnas y guarda fail-closed
  const cols = await q("SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE d, IS_NULLABLE n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()");
  const info = new Map(cols.map((c) => [`${c.t}.${c.c}`, { type: c.d, nullable: c.n === "YES" }]));
  const tables = new Set(cols.map((c) => c.t));
  const wipeTables = WIPE_TABLES.filter((t) => tables.has(t));

  const known = new Set();
  const listed = [];
  const addKnown = (map) => Object.entries(map).forEach(([t, cs]) => cs.forEach((c) => { known.add(`${t}.${c}`); listed.push(`${t}.${c}`); }));
  [IDENT, KEEP, SCRUB, WIPE, MONEY, NON_MONEY, FILE_AUX_COLS].forEach(addKnown);
  for (const [t, , url, key, name] of FILE_GROUPS) [url, key, name].filter(Boolean).forEach((c) => { known.add(`${t}.${c}`); listed.push(`${t}.${c}`); });

  const missing = listed.filter((k) => !info.has(k));
  if (missing.length) die(`Columnas clasificadas que ya no existen en la base (revisar scripts/anonymizeDemo.js): ${missing.join(", ")}`);
  const unclassified = cols.filter((c) => c.t !== "SequelizeMeta" && !wipeTables.includes(c.t) && (TEXT_TYPES.has(c.d) || NUM_TYPES.has(c.d)) && !known.has(`${c.t}.${c.c}`)).map((c) => `${c.t}.${c.c} (${c.d})`);
  if (unclassified.length) die(`Columnas SIN CLASIFICAR (no se sabe si son sensibles). Agregalas a las listas del script:\n  ${unclassified.join("\n  ")}`);
  const badMoney = [...Object.entries(MONEY)].flatMap(([t, cs]) => cs.map((c) => `${t}.${c}`)).filter((k) => !NUM_TYPES.has(info.get(k).type));
  if (badMoney.length) die(`Columnas de dinero que no son decimales: ${badMoney.join(", ")}`);

  const fks = await q("SELECT TABLE_NAME t, COLUMN_NAME c, REFERENCED_TABLE_NAME r FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL");
  const danglers = fks.filter((f) => wipeTables.includes(f.r) && !wipeTables.includes(f.t));
  if (danglers.length) die(`Hay FKs desde tablas que se conservan hacia tablas que se vacían: ${danglers.map((f) => `${f.t}.${f.c} → ${f.r}`).join(", ")}`);
  log(`Clasificación completa: ${listed.length} columnas listadas, ${wipeTables.length} tablas a vaciar.`);

  // ── términos reales (lista negra) y mapa de reemplazo
  const terms = new Map(); // minúscula(real) -> ficticio
  const blacklist = new Set();
  const addBlack = (value, min = 4) => {
    if (value === null || value === undefined) return;
    const v = String(value).trim();
    if (v.length >= min) blacklist.add(v);
  };
  const addTerm = (real, fake, { min = 4 } = {}) => {
    if (real === null || real === undefined || fake === null || fake === undefined) return;
    const v = String(real).trim();
    if (v.length < min) return;
    addBlack(v, min);
    if (!terms.has(v.toLowerCase())) terms.set(v.toLowerCase(), String(fake));
    if (/^\d{11}$/.test(v) && fake && /^\d{11}$/.test(String(fake))) {
      addBlack(dash(v)); terms.set(dash(v).toLowerCase(), dash(String(fake)));
    }
  };
  const LEGAL = /\b(s\.?\s?a\.?s?\.?|s\.?\s?r\.?\s?l\.?|s\.?\s?a\.?\s?c\.?\s?i\.?|sociedad an[oó]nima)\s*$/i;
  const addCompanyTerm = (real, fake) => {
    addTerm(real, fake);
    const core = String(real || "").replace(LEGAL, "").replace(/[.,\s]+$/, "").trim();
    if (core.length >= 5 && core.toLowerCase() !== String(real).toLowerCase()) addTerm(core, String(fake).replace(LEGAL, "").trim() || fake, { min: 5 });
  };
  let termRegex = null;
  const compileTerms = () => {
    const list = [...terms.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
    termRegex = list.length ? new RegExp(list.join("|"), "gi") : null;
  };
  const scrubText = (value) => (termRegex && typeof value === "string" ? value.replace(termRegex, (m) => terms.get(m.toLowerCase()) ?? m) : value);
  const scrubJson = (value) => {
    if (value === null || value === undefined) return null;
    const obj = typeof value === "string" ? JSON.parse(value) : value;
    return JSON.stringify(JSON.parse(scrubText(JSON.stringify(obj))));
  };
  const setRow = async (table, id, values) => {
    const keys = Object.keys(values);
    if (!keys.length) return;
    await q(`UPDATE ${bt(table)} SET ${keys.map((k) => `${bt(k)}=?`).join(", ")} WHERE id=?`, [...keys.map((k) => values[k]), id]);
  };

  // ── lectura previa de los datos reales (antes de tocar nada)
  const users = await q("SELECT u.id, u.name, u.lastname, u.email, u.cuit, u.phone, u.celphone, r.`key` role_key, r.name role_name FROM Users u LEFT JOIN Roles r ON r.id=u.role_id ORDER BY u.id");
  const emps = await q("SELECT id, name, lastname, dni, cuil, address, phone, email, user_id FROM Employees ORDER BY id");
  const supervisors = await q("SELECT id, name, lastname, email, phone FROM ClientSupervisors ORDER BY id");
  const clients = await q("SELECT id, razon_social, email, phone, cuit, fiscal_street, fiscal_locality, fiscal_province FROM Clients ORDER BY id");
  const providers = await q("SELECT id, razon_social, email, phone FROM Providers WHERE is_system=0 ORDER BY id");
  const companies = await q("SELECT * FROM CompanyProfiles ORDER BY id");
  const banks = await q("SELECT id, cbu, alias FROM CompanyBankAccounts ORDER BY id");
  const plants = await q("SELECT id, name, address FROM Plants ORDER BY id");
  const projects = await q("SELECT id, code, name FROM Projects ORDER BY id");

  // Para no repetir un nombre real como ficticio: se sacan de los pools los que coincidan con la lista negra.
  const realWords = new Set();
  [...users, ...emps, ...supervisors].forEach((p) => { realWords.add(String(p.name || "").toLowerCase()); realWords.add(String(p.lastname || "").toLowerCase()); });
  const safe = (pool) => { const f = pool.filter((x) => !realWords.has(x.toLowerCase())); return f.length ? f : pool; };
  const firstPool = safe(FIRST_NAMES);
  const lastPool = safe(LAST_NAMES);

  // Desde acá todo es UNA transacción: si algo falla (o es --dry-run), la base queda como estaba.
  await conn.query("SET FOREIGN_KEY_CHECKS=0");
  await conn.beginTransaction();
  let committed = false;
  try {
  // ─────────────── identidades
  const used = { dni: new Set(), userCuit: new Set(), company: new Set(), plant: new Set(), plate: new Set(), cbu: new Set(), clientCuit: new Set() };
  const newEmp = new Map();
  const addPersonTerms = (p, np) => {
    addTerm(p.name, np.name, { min: 5 }); addTerm(p.lastname, np.lastname, { min: 5 });
    if (p.name && p.lastname) { addTerm(`${p.lastname} ${p.name}`, `${np.lastname} ${np.name}`, { min: 6 }); addTerm(`${p.name} ${p.lastname}`, `${np.name} ${np.lastname}`, { min: 6 }); addTerm(`${p.lastname}, ${p.name}`, `${np.lastname}, ${np.name}`, { min: 6 }); }
    addBlack(p.lastname, 5); addBlack(p.name, 5);
  };
  const phoneFor = (rnd, old) => (old && String(old).trim() !== "" ? `11${digits(8, rnd)}` : old);

  for (const e of emps) {
    const rnd = rngFor(`emp-${e.id}`);
    const np = { name: pickFrom(firstPool, rnd), lastname: pickFrom(lastPool, rnd) };
    const dni = uniqueValue(used.dni, () => String(10000000 + Math.floor(rnd() * 45000000)));
    let cuil = null;
    for (const prefix of ["20", "27", "23", "24"]) { const c = withVerifier(prefix + dni); if (c && isValidCuit(c)) { cuil = c; break; } }
    const values = {
      name: np.name, lastname: np.lastname, dni, cuil: dash(cuil),
      address: e.address ? `${pickFrom(STREETS, rnd)} ${100 + Math.floor(rnd() * 3900)}` : e.address,
      phone: phoneFor(rnd, e.phone),
      email: e.email ? `${slug(np.name)}.${slug(np.lastname)}${e.id}@demo.local` : e.email,
    };
    newEmp.set(e.id, { ...np, values, cuilDigits: cuil, phone: values.phone });
    addPersonTerms(e, np);
    addTerm(e.dni, dni, { min: 6 }); addTerm(e.cuil, dash(cuil), { min: 8 }); addTerm(String(e.cuil || "").replace(/\D/g, ""), cuil, { min: 10 });
    addTerm(e.address, values.address, { min: 6 }); addTerm(e.phone, values.phone, { min: 8 }); addTerm(e.email, values.email, { min: 6 });
    await setRow("Employees", e.id, values);
    if (e.dni) { addBlack(e.dni, 6); } if (e.cuil) { addBlack(String(e.cuil).replace(/\D/g, ""), 10); }
  }
  log(`Empleados: ${emps.length}`);

  const demoPassword = `Demo-${crypto.randomBytes(5).toString("hex")}`;
  const passwordHash = bcrypt.hashSync(demoPassword, 10);
  const credentials = [];
  let adminAssigned = false;
  const empByUser = new Map(emps.filter((e) => e.user_id).map((e) => [e.user_id, e]));
  for (const u of users) {
    const rnd = rngFor(`user-${u.id}`);
    const linked = empByUser.get(u.id) ? newEmp.get(empByUser.get(u.id).id) : null;
    const np = linked ? { name: linked.name, lastname: linked.lastname } : { name: pickFrom(firstPool, rnd), lastname: pickFrom(lastPool, rnd) };
    let email;
    if (u.role_key === "admin" && !adminAssigned) { email = "admin@demo.local"; adminAssigned = true; } else email = `usuario${u.id}@demo.local`;
    const cuit = uniqueValue(used.userCuit, (i) => (linked && i === 0 && !used.userCuit.has(linked.cuilDigits) ? linked.cuilDigits : makeCuit(["20", "27"], rnd)));
    const values = { name: np.name, lastname: np.lastname, email, cuit, password: passwordHash, phone: phoneFor(rnd, u.phone), celphone: phoneFor(rnd, u.celphone), must_change_password: 0 };
    addPersonTerms(u, np);
    addTerm(u.email, email, { min: 6 }); addTerm(u.cuit, cuit, { min: 10 }); addTerm(u.phone, values.phone, { min: 8 }); addTerm(u.celphone, values.celphone, { min: 8 });
    await setRow("Users", u.id, values);
    credentials.push({ id: u.id, email, role: u.role_name || u.role_key || "(sin rol)", name: `${np.name} ${np.lastname}` });
  }
  log(`Usuarios: ${users.length} (todos con la misma contraseña demo)`);

  for (const s of supervisors) {
    const rnd = rngFor(`sup-${s.id}`);
    const np = { name: pickFrom(firstPool, rnd), lastname: pickFrom(lastPool, rnd) };
    const values = { ...np, email: s.email ? `${slug(np.name)}.${slug(np.lastname)}${s.id}@cliente-demo.local` : s.email, phone: phoneFor(rnd, s.phone) };
    addPersonTerms(s, np); addTerm(s.email, values.email, { min: 6 }); addTerm(s.phone, values.phone, { min: 8 });
    await setRow("ClientSupervisors", s.id, values);
  }

  const cuitMap = new Map();
  for (const c of clients) {
    const rnd = rngFor(`client-${c.id}`);
    const razon = uniqueValue(used.company, (i) => { const base = pickFrom(COMPANY_NAMES, rnd); return i === 0 ? base : base.replace(/ (S\.A\.|S\.R\.L\.)$/, ` ${pickFrom(PLACE_NAMES, rnd)} $1`); });
    const cuit = uniqueValue(used.clientCuit, () => makeCuit(["30", "33"], rnd));
    const values = {
      razon_social: razon, cuit, email: c.email ? `contacto${c.id}@cliente-demo.local` : c.email, phone: phoneFor(rnd, c.phone),
      fiscal_street: c.fiscal_street ? `${pickFrom(STREETS, rnd)} ${100 + Math.floor(rnd() * 3900)}` : c.fiscal_street,
      fiscal_locality: c.fiscal_locality ? pickFrom(LOCALITIES, rnd) : c.fiscal_locality,
      fiscal_province: c.fiscal_province ? pickFrom(PROVINCES, rnd) : c.fiscal_province,
    };
    addCompanyTerm(c.razon_social, razon);
    const oldCuit = String(c.cuit || "").replace(/\D/g, "");
    if (oldCuit) { cuitMap.set(oldCuit, cuit); addTerm(oldCuit, cuit, { min: 10 }); }
    addTerm(c.email, values.email, { min: 6 }); addTerm(c.phone, values.phone, { min: 8 }); addTerm(c.fiscal_street, values.fiscal_street, { min: 6 });
    await setRow("Clients", c.id, values);
  }
  log(`Clientes: ${clients.length}`);

  const PROV_A = ["Aceros", "Tubos", "Ferretería", "Distribuidora", "Suministros", "Metales", "Bulonería", "Soldaduras", "Pinturas", "Equipos"];
  const PROV_B = ["del Centro", "Industrial", "Norte", "Rioplatense", "Pampa", "Austral", "San Jorge", "Del Este", "Ruiz y Cía.", "Moderna"];
  for (const p of providers) {
    const rnd = rngFor(`prov-${p.id}`);
    const razon = uniqueValue(used.company, (i) => `${pickFrom(PROV_A, rnd)} ${pickFrom(PROV_B, rnd)} ${pickFrom(["S.A.", "S.R.L.", ""], rnd)}`.trim() + (i > 20 ? ` ${i}` : ""));
    const values = { razon_social: razon, email: p.email ? `ventas${p.id}@proveedor-demo.local` : p.email, phone: phoneFor(rnd, p.phone) };
    addCompanyTerm(p.razon_social, razon); addTerm(p.email, values.email, { min: 6 }); addTerm(p.phone, values.phone, { min: 8 });
    await setRow("Providers", p.id, values);
  }
  log(`Proveedores: ${providers.length}`);

  const companyCuit = DEMO_CUIT || makeCuit(["30"], rngFor("company"));
  for (const c of companies) {
    const rnd = rngFor(`company-${c.id}`);
    const values = {
      legal_name: "Montajes Demo S.A.", display_name: "Montajes Demo", cuit: companyCuit,
      address_street: c.address_street ? "Av. de Ejemplo" : c.address_street, address_number: c.address_number ? "1234" : c.address_number,
      address_locality: c.address_locality ? "Rosario" : c.address_locality, address_province: c.address_province ? "Santa Fe" : c.address_province,
      iibb_number: c.iibb_number ? `9${digits(9, rnd)}` : c.iibb_number, email: c.email ? "contacto@montajesdemo.local" : c.email, phone: c.phone ? "1145678901" : c.phone,
    };
    addCompanyTerm(c.legal_name, values.legal_name); addCompanyTerm(c.display_name, values.display_name);
    addTerm(c.cuit, companyCuit, { min: 10 }); addTerm(c.email, values.email, { min: 6 }); addTerm(c.phone, values.phone, { min: 8 });
    addTerm(c.address_street, values.address_street, { min: 6 }); addTerm(c.iibb_number, values.iibb_number, { min: 6 });
    await setRow("CompanyProfiles", c.id, values);
  }
  for (const b of banks) {
    const rnd = rngFor(`bank-${b.id}`);
    const cbu = uniqueValue(used.cbu, () => makeCbu(rnd));
    const alias = b.alias ? `demo.cuenta${b.id}` : b.alias;
    addTerm(b.cbu, cbu, { min: 10 }); addTerm(b.alias, alias, { min: 6 });
    await setRow("CompanyBankAccounts", b.id, { cbu, alias });
  }
  await q("UPDATE CompanyPointsOfSale SET address='Av. de Ejemplo 1234, Rosario' WHERE address IS NOT NULL");
  await q("UPDATE CompanyPointsOfSale SET usage_description='Punto de venta demo' WHERE usage_description IS NOT NULL");

  for (const p of plants) {
    const rnd = rngFor(`plant-${p.id}`);
    const name = uniqueValue(used.plant, (i) => `Planta ${pickFrom(PLACE_NAMES, rnd)}${i ? ` ${i + 1}` : ""}`);
    const values = { name, address: p.address ? `${pickFrom(STREETS, rnd)} ${100 + Math.floor(rnd() * 3900)}, ${pickFrom(LOCALITIES, rnd)}` : p.address };
    addTerm(p.name, name, { min: 5 }); addTerm(p.address, values.address, { min: 8 });
    await setRow("Plants", p.id, values);
  }
  for (const p of projects) {
    const rnd = rngFor(`project-${p.id}`);
    const code = `D-${1000 + p.id}`;
    const name = `${pickFrom(WORK_NAMES, rnd)} - ${code}`;
    addTerm(p.code, code, { min: 5 }); addTerm(p.name, name, { min: 6 });
    await setRow("Projects", p.id, { code, name });
  }

  // Títulos y números de documentos del cliente (el id garantiza que no se repitan).
  const byId = async (table, cols2, build) => {
    const rows = await q(`SELECT id, ${cols2.map(bt).join(", ")} FROM ${bt(table)} ORDER BY id`);
    for (const r of rows) {
      const rnd = rngFor(`${table}-${r.id}`);
      const values = build(r, rnd);
      for (const [col, fake] of Object.entries(values)) addTerm(r[col], fake, { min: 5 });
      await setRow(table, r.id, values);
    }
    return rows.length;
  };
  await byId("Budgets", ["title", "work_order_number"], (r, rnd) => ({ title: pickFrom(WORK_NAMES, rnd), work_order_number: r.work_order_number ? `OT-${10000 + r.id}` : r.work_order_number }));
  await byId("QuoteRequests", ["title", "client_quote_number"], (r, rnd) => ({ title: pickFrom(WORK_NAMES, rnd), client_quote_number: `CP-${10000 + r.id}` }));
  await byId("ClientPurchaseOrders", ["number"], (r) => ({ number: `OC-${1000 + r.id}` }));
  await byId("BudgetProgressEntries", ["certificate_number"], (r) => ({ certificate_number: r.certificate_number ? `CERT-${r.id}` : r.certificate_number }));
  await byId("SuretyBonds", ["insurer", "policy_number"], (r) => ({ insurer: "Aseguradora Demo S.A.", policy_number: `POL-${100000 + r.id}` }));
  await byId("EntityDocuments", ["title"], (r) => ({ title: `Documento ${r.id}` }));
  await byId("Vehicles", ["plate"], (r, rnd) => ({ plate: uniqueValue(used.plate, () => `${pickFrom(["A", "B", "C", "D", "E"], rnd)}${pickFrom(["A", "B", "C", "D", "E"], rnd)}${digits(3, rnd)}${pickFrom(["F", "G", "H", "J"], rnd)}${pickFrom(["F", "G", "H", "J"], rnd)}`) }));

  // ─────────────── facturas (JSON y datos de emisión)
  const invoices = await q("SELECT id, cae, recipient_doc_number, manual_recipient FROM Invoices ORDER BY id");
  const invoiceNew = new Map();
  for (const inv of invoices) {
    const rnd = rngFor(`invoice-${inv.id}`);
    const values = { remito_number: null, commercial_reference: null };
    let manualCuit = null;
    if (inv.manual_recipient) {
      const manual = typeof inv.manual_recipient === "string" ? JSON.parse(inv.manual_recipient) : inv.manual_recipient;
      manualCuit = makeCuit(["30", "20"], rnd);
      const fake = { ...manual, legal_name: `Cliente Ocasional ${inv.id}`, cuit: manualCuit };
      for (const k of ["fiscal_street", "fiscal_locality", "fiscal_province", "email", "phone"]) if (manual[k]) fake[k] = k === "fiscal_street" ? `${pickFrom(STREETS, rnd)} ${100 + Math.floor(rnd() * 3900)}` : k === "fiscal_locality" ? pickFrom(LOCALITIES, rnd) : k === "fiscal_province" ? pickFrom(PROVINCES, rnd) : k === "email" ? `ocasional${inv.id}@demo.local` : "1145678901";
      for (const k of Object.keys(fake)) if (typeof manual[k] === "string" && manual[k] !== fake[k]) addTerm(manual[k], fake[k], { min: 4 });
      addTerm(String(manual.cuit || "").replace(/\D/g, ""), manualCuit, { min: 10 });
      values.manual_recipient = JSON.stringify(fake);
    }
    if (inv.cae) { values.cae = digits(14, rnd); addTerm(inv.cae, values.cae, { min: 10 }); }
    if (inv.recipient_doc_number) {
      const old = String(inv.recipient_doc_number).replace(/\D/g, "");
      const fake = cuitMap.get(old) || manualCuit || (old.length === 11 ? makeCuit(["30", "20"], rnd) : digits(old.length || 8, rnd));
      values.recipient_doc_number = fake; addTerm(old, fake, { min: 7 }); addBlack(old, 7);
    }
    invoiceNew.set(inv.id, values);
  }
  compileTerms(); // a partir de acá los términos están completos
  const invoiceJson = await q("SELECT id, arca_result, fce_arca_snapshot, fce_rejection_reasons, issuer_snapshot, recipient_snapshot FROM Invoices ORDER BY id");
  for (const row of invoiceJson) {
    const values = { ...invoiceNew.get(row.id) };
    for (const col of ["arca_result", "fce_arca_snapshot", "fce_rejection_reasons", "issuer_snapshot", "recipient_snapshot"]) if (row[col] !== null) values[col] = scrubJson(row[col]);
    await setRow("Invoices", row.id, values);
  }
  log(`Facturas: ${invoices.length}`);


  // ─────────────── vaciado de tablas, scrub de descripciones y borrado de texto libre
  for (const t of wipeTables) {
    const [res] = await conn.query(`DELETE FROM ${bt(t)}`);
    if (res.affectedRows) log(`  vaciada ${t} (${res.affectedRows} filas)`);
  }
  let scrubbed = 0;
  for (const [t, cs] of Object.entries(SCRUB)) {
    for (const c of cs) {
      const rows = await q(`SELECT id, ${bt(c)} v FROM ${bt(t)} WHERE ${bt(c)} IS NOT NULL`);
      for (const r of rows) {
        const next = scrubText(r.v);
        if (next !== r.v) { await q(`UPDATE ${bt(t)} SET ${bt(c)}=? WHERE id=?`, [next, r.id]); scrubbed++; }
      }
    }
  }
  log(`Descripciones scrubeadas: ${scrubbed} filas modificadas`);
  for (const [t, cs] of Object.entries(WIPE)) {
    for (const c of cs) {
      const nullable = info.get(`${t}.${c}`).nullable;
      await q(`UPDATE ${bt(t)} SET ${bt(c)}=${nullable ? "NULL" : "''"} WHERE ${bt(c)} IS NOT NULL`);
    }
  }
  log("Texto libre borrado.");

  // ─────────────── montos: factor global que siempre achica (÷1,4 a ÷2). No se imprime ni se guarda.
  const factor = 1 / (1.4 + (crypto.randomInt(0, 1000001) / 1000000) * 0.6);
  for (const [t, cs] of Object.entries(MONEY)) {
    for (const c of cs) await q(`UPDATE ${bt(t)} SET ${bt(c)}=ROUND(${bt(c)}*?, 2) WHERE ${bt(c)} IS NOT NULL`, [factor]);
  }
  // El redondeo por columna puede dejar neto+IVA≠total por centavos: se recalcula solo donde la diferencia es de redondeo.
  await q("UPDATE Invoices SET iva_amount=ROUND(net_amount*iva_rate/100, 2), total_amount=ROUND(net_amount+ROUND(net_amount*iva_rate/100, 2), 2) WHERE ABS(net_amount+iva_amount-total_amount) < 0.05");
  log("Montos achicados con un factor secreto.");

  // ─────────────── archivos: cada referencia pasa a ser una copia propia de un placeholder en el bucket demo
  const placeholders = {
    doc: { key: "demo/_placeholders/documento.pdf", ext: "pdf", ct: "application/pdf", label: "Documento", buf: await makePdf() },
    image: { key: "demo/_placeholders/imagen.png", ext: "png", ct: "image/png", label: "Imagen", buf: makeImagePng() },
    signature: { key: "demo/_placeholders/firma.png", ext: "png", ct: "image/png", label: "Firma", buf: makeSignaturePng() },
  };
  const copies = new Map();
  if (SKIP_FILES) {
    log("⚠ --skip-files: las referencias a archivos NO se tocaron (siguen apuntando al bucket real). No usar así para la demo.");
  } else {
    const publicBase = process.env.STORAGE_PUBLIC_URL;
    const isHttp = (v) => /^https?:\/\//i.test(v || "");
    const refFor = (existing, newKey) => (isHttp(existing) ? `${publicBase}/${newKey}` : newKey);
    for (const [t, slot, urlCol, keyCol, nameCol, baseKind] of FILE_GROUPS) {
      const selectCols = [urlCol, keyCol, nameCol].filter(Boolean);
      const rows = await q(`SELECT id, ${selectCols.map(bt).join(", ")} FROM ${bt(t)} WHERE ${selectCols.map((c) => `${bt(c)} IS NOT NULL`).join(" OR ")}`);
      for (const r of rows) {
        if (r[urlCol] === null && (!keyCol || r[keyCol] === null)) continue;
        if (t === "Media" && !isHttp(r[urlCol])) continue; // imágenes estáticas del front: no son archivos de R2
        let kind = baseKind;
        if (kind === "doc") {
          const ext = path.extname(String(r[nameCol] || r[keyCol] || r[urlCol] || "").split("?")[0]).toLowerCase();
          if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) kind = "image";
        }
        const ph = placeholders[kind];
        const newKey = `demo/${t}/${r.id}-${slot}.${ph.ext}`;
        copies.set(newKey, kind);
        const values = {};
        if (r[urlCol] !== null) values[urlCol] = refFor(r[urlCol], newKey);
        if (keyCol && r[keyCol] !== null) values[keyCol] = refFor(r[keyCol], newKey);
        if (nameCol && r[nameCol] !== null) values[nameCol] = `${ph.label}-${r.id}.${ph.ext}`;
        if (slot === "file") {
          if (info.has(`${t}.mime_type`)) values.mime_type = ph.ct;
          if (info.has(`${t}.size_bytes`)) values.size_bytes = ph.buf.length;
        }
        await setRow(t, r.id, values);
      }
    }
    log(`Referencias a archivos reescritas: ${copies.size}`);
    if (!DRY_RUN) {
      for (const ph of Object.values(placeholders)) await s3.send(new S3.PutObjectCommand({ Bucket: bucket, Key: ph.key, Body: ph.buf, ContentType: ph.ct }));
      const entries = [...copies.entries()];
      for (let i = 0; i < entries.length; i += 8) {
        await Promise.all(entries.slice(i, i + 8).map(([key, kind]) => s3.send(new S3.CopyObjectCommand({
          Bucket: bucket, Key: key, CopySource: encodeURI(`${bucket}/${placeholders[kind].key}`), ContentType: placeholders[kind].ct, MetadataDirective: "REPLACE",
        }))));
      }
      log(`R2: ${entries.length} copias creadas en "${bucket}".`);
    } else {
      log(`(dry-run) R2: se crearían ${copies.size} copias en "${bucket}".`);
    }
  }

  // ─────────────── verificación rápida (informativa; la fuerte es checkDemoLeaks.js)
  const [badSum] = await q("SELECT COUNT(*) n FROM Invoices WHERE ABS(net_amount+iva_amount-total_amount) > 0.011");
  log(`Facturas con neto+IVA≠total: ${badSum.n}${badSum.n ? " (revisar: pueden venir así de origen, p. ej. con otros tributos)" : ""}`);
  if (!SKIP_FILES) {
    let notDemo = 0;
    for (const [t, , urlCol] of FILE_GROUPS) {
      const extra = t === "Media" ? ` AND ${bt(urlCol)} REGEXP '^https?://'` : "";
      const [r] = await q(`SELECT COUNT(*) n FROM ${bt(t)} WHERE ${bt(urlCol)} IS NOT NULL AND ${bt(urlCol)} NOT LIKE '%demo/%'${extra}`);
      notDemo += r.n;
    }
    log(`Referencias a archivos que NO apuntan a demo/: ${notDemo}${notDemo ? "  ← REVISAR" : ""}`);
    if (notDemo) throw new Error("Quedaron referencias a archivos fuera de demo/.");
  }

  // ─────────────── cierre
  if (DRY_RUN) {
    await conn.rollback();
    log("DRY-RUN terminado: ROLLBACK hecho, la base no cambió. Todas las sentencias se ejecutaron sin error.");
    log(`Se registraron ${blacklist.size} valores reales para la lista negra y ${terms.size} reemplazos.`);
  } else {
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify({ generated_at: new Date().toISOString(), terms: [...blacklist].sort() }), { mode: 0o600 });
    await conn.commit();
    committed = true;
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
    await conn.query(`CREATE TABLE ${bt(MARKER_TABLE)} (id INT PRIMARY KEY, anonymized_at DATETIME NOT NULL)`);
    await conn.query(`INSERT INTO ${bt(MARKER_TABLE)} VALUES (1, NOW())`);
    const lines = [
      "# Credenciales de la demo", "", "Archivo local, NO se commitea (.gitignore). Borralo cuando ya no lo necesites.", "",
      `Contraseña de TODOS los usuarios: \`${demoPassword}\``, "", "| Email | Rol | Nombre |", "|---|---|---|",
      ...credentials.map((c) => `| ${c.email} | ${c.role} | ${c.name} |`), "",
      `CUIT de la empresa (debe coincidir con ARCA_CUIT del entorno demo): ${companyCuit}`,
    ];
    fs.writeFileSync(CREDENTIALS_FILE, lines.join("\n") + "\n", { mode: 0o600 });
    log(`LISTO. Base anonimizada. Credenciales en ${path.relative(process.cwd(), CREDENTIALS_FILE)} y lista negra en ${path.relative(process.cwd(), BLACKLIST_FILE)}.`);
    log("Siguiente paso: node scripts/checkDemoLeaks.js (tiene que dar 0 coincidencias).");
  }
  } catch (error) {
    if (!committed) { try { await conn.rollback(); } catch { /* ya cerrada */ } }
    try { await conn.query("SET FOREIGN_KEY_CHECKS=1"); } catch { /* ignorar */ }
    await conn.end().catch(() => {});
    die(`Falló y se hizo ROLLBACK (la base no cambió${committed ? "… salvo el commit ya hecho" : ""}): ${error.stack || error.message}`);
  }
  await conn.end();
}

main().catch((error) => die(error.stack || error.message));
