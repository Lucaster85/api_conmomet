const { sendServerError } = require("../helpers/httpErrors");
const db = require("../models");
const { normalizeCuit, isValidCuit } = require("../helpers/cuit");
const { normalizeCbu, isValidCbu, isValidCbuAlias } = require("../helpers/cbu");
const { recordAudit } = require("../services/auditLogService");
const arca = require("../services/arca");

// "Datos de mi empresa" (PLAN_ARCA.md §3.0) y conexión con ARCA. Todo cuelga de /company-settings y se protege con
// requirePermission("company_settings_update") en routes/index.js: authPermission derivaría `company_settings_read`/_write,
// que no existen (mismo criterio que /system-settings/privacy-texts).

const VAT_CONDITIONS = ["responsable_inscripto", "monotributo", "exento"];
const FCE_OPTIONS = ["SCA", "ADC"];
const POS_TYPES = ["web_service", "manual"];
const CURRENCIES = ["ARS", "USD"];

const PROFILE_FIELDS = [
  "legal_name", "display_name", "cuit", "address_street", "address_number", "address_locality", "address_province",
  "vat_condition", "iibb_number", "activity_start_date", "email", "phone", "fce_transfer_option",
];

function cleanText(value, max) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (text === "") return null;
  return text.length > max ? text.slice(0, max) : text;
}

// Los errores de ARCA son esperables (red, certificado, ARCA caído): se devuelven con un mensaje legible y un `code`
// estable, nunca como 500 ni con detalles internos.
function sendArcaError(res, error) {
  if (error instanceof arca.ArcaError) {
    const status = error.code === "disabled" || error.code === "config" ? 409 : 502;
    return res.status(status).json({ error: error.message, code: `arca_${error.code}` });
  }
  return res.status(500).json({ error: "Error inesperado al hablar con ARCA." });
}

async function clearOtherDefaults(model, keepId, transaction) {
  await model.update({ is_default: false }, { where: { id: { [db.Sequelize.Op.ne]: keepId } }, transaction });
}

module.exports = {
  // GET /company-settings — todo junto: perfil, puntos de venta, cuentas y estado de ARCA (sin llamar a ARCA).
  get: async (req, res) => {
    try {
      const [profile] = await db.CompanyProfile.findOrCreate({ where: { id: 1 }, defaults: {} });
      const [pointsOfSale, bankAccounts, arcaStatus] = await Promise.all([
        db.CompanyPointOfSale.findAll({ order: [["number", "ASC"]] }),
        db.CompanyBankAccount.findAll({ order: [["is_default", "DESC"], ["bank_name", "ASC"]] }),
        arca.getStatus(),
      ]);
      return res.status(200).json({ data: { profile, points_of_sale: pointsOfSale, bank_accounts: bankAccounts, arca: arcaStatus } });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // PUT /company-settings/profile
  updateProfile: async (req, res) => {
    try {
      const body = req.body || {};
      const patch = {};

      for (const [field, max] of [
        ["legal_name", 150], ["display_name", 150], ["address_street", 150], ["address_number", 20],
        ["address_locality", 100], ["address_province", 100], ["iibb_number", 30], ["email", 150], ["phone", 50],
      ]) {
        if (body[field] !== undefined) patch[field] = cleanText(body[field], max);
      }

      if (body.cuit !== undefined) {
        const cuit = normalizeCuit(body.cuit);
        if (cuit !== null && !isValidCuit(cuit)) return res.status(400).json({ error: "El CUIT no es válido." });
        patch.cuit = cuit;
      }
      if (body.vat_condition !== undefined) {
        if (!VAT_CONDITIONS.includes(body.vat_condition)) return res.status(400).json({ error: "Condición de IVA inválida." });
        patch.vat_condition = body.vat_condition;
      }
      if (body.fce_transfer_option !== undefined) {
        if (!FCE_OPTIONS.includes(body.fce_transfer_option)) return res.status(400).json({ error: "Opción de transferencia inválida (SCA o ADC)." });
        patch.fce_transfer_option = body.fce_transfer_option;
      }
      if (body.activity_start_date !== undefined) {
        if (body.activity_start_date === null || body.activity_start_date === "") {
          patch.activity_start_date = null;
        } else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.activity_start_date)) || Number.isNaN(Date.parse(body.activity_start_date))) {
          return res.status(400).json({ error: "La fecha de inicio de actividades es inválida." });
        } else {
          patch.activity_start_date = body.activity_start_date;
        }
      }
      if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
        return res.status(400).json({ error: "El email no es válido." });
      }

      const [profile] = await db.CompanyProfile.findOrCreate({ where: { id: 1 }, defaults: {} });
      const changed = PROFILE_FIELDS.filter((f) => patch[f] !== undefined && String(patch[f] ?? "") !== String(profile[f] ?? ""));
      await profile.update(patch);

      if (changed.length > 0) {
        await recordAudit({
          entityType: "CompanyProfile", entityId: profile.id, action: "update",
          context: { fields: changed }, userId: req.user && req.user.id,
        });
      }
      return res.status(200).json({ data: profile });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // --- Puntos de venta ---
  createPointOfSale: async (req, res) => {
    try {
      const parsed = parsePointOfSale(req.body || {}, true);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const created = await db.sequelize.transaction(async (transaction) => {
        const exists = await db.CompanyPointOfSale.findOne({ where: { number: parsed.value.number }, transaction });
        if (exists) return null;
        const pos = await db.CompanyPointOfSale.create(parsed.value, { transaction });
        if (pos.is_default) await clearOtherDefaults(db.CompanyPointOfSale, pos.id, transaction);
        return pos;
      });
      if (!created) return res.status(409).json({ error: `Ya existe el punto de venta ${parsed.value.number}.` });

      await recordAudit({ entityType: "CompanyPointOfSale", entityId: created.id, action: "create", newValue: created.number, userId: req.user && req.user.id });
      return res.status(201).json({ data: created });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  updatePointOfSale: async (req, res) => {
    try {
      const parsed = parsePointOfSale(req.body || {}, false);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const result = await db.sequelize.transaction(async (transaction) => {
        const pos = await db.CompanyPointOfSale.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!pos) return { notFound: true };
        if (parsed.value.number !== undefined && parsed.value.number !== pos.number) {
          const clash = await db.CompanyPointOfSale.findOne({ where: { number: parsed.value.number }, transaction });
          if (clash) return { conflict: parsed.value.number };
        }
        await pos.update(parsed.value, { transaction });
        if (pos.is_default) await clearOtherDefaults(db.CompanyPointOfSale, pos.id, transaction);
        return { pos };
      });
      if (result.notFound) return res.status(404).json({ error: "Punto de venta no encontrado." });
      if (result.conflict) return res.status(409).json({ error: `Ya existe el punto de venta ${result.conflict}.` });

      await recordAudit({ entityType: "CompanyPointOfSale", entityId: result.pos.id, action: "update", newValue: result.pos.number, userId: req.user && req.user.id });
      return res.status(200).json({ data: result.pos });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  deletePointOfSale: async (req, res) => {
    try {
      const pos = await db.CompanyPointOfSale.findByPk(req.params.id);
      if (!pos) return res.status(404).json({ error: "Punto de venta no encontrado." });
      try {
        await pos.destroy();
      } catch (error) {
        // Cuando las facturas lo referencien (etapa 2), la FK RESTRICT llega por acá.
        if (error.name === "SequelizeForeignKeyConstraintError") {
          return res.status(409).json({ error: "El punto de venta tiene facturas. Desactivalo en lugar de eliminarlo." });
        }
        throw error;
      }
      await recordAudit({ entityType: "CompanyPointOfSale", entityId: pos.id, action: "delete", previousValue: pos.number, userId: req.user && req.user.id });
      return res.status(200).json({ data: { id: pos.id } });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // --- Cuentas bancarias ---
  createBankAccount: async (req, res) => {
    try {
      const parsed = parseBankAccount(req.body || {}, true);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const created = await db.sequelize.transaction(async (transaction) => {
        const exists = await db.CompanyBankAccount.findOne({ where: { cbu: parsed.value.cbu }, transaction });
        if (exists) return null;
        const account = await db.CompanyBankAccount.create(parsed.value, { transaction });
        if (account.is_default) await clearOtherDefaults(db.CompanyBankAccount, account.id, transaction);
        return account;
      });
      if (!created) return res.status(409).json({ error: "Ya existe una cuenta con ese CBU." });

      await recordAudit({ entityType: "CompanyBankAccount", entityId: created.id, action: "create", newValue: created.bank_name, userId: req.user && req.user.id });
      return res.status(201).json({ data: created });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  updateBankAccount: async (req, res) => {
    try {
      const parsed = parseBankAccount(req.body || {}, false);
      if (parsed.error) return res.status(400).json({ error: parsed.error });

      const result = await db.sequelize.transaction(async (transaction) => {
        const account = await db.CompanyBankAccount.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!account) return { notFound: true };
        if (parsed.value.cbu !== undefined && parsed.value.cbu !== account.cbu) {
          const clash = await db.CompanyBankAccount.findOne({ where: { cbu: parsed.value.cbu }, transaction });
          if (clash) return { conflict: true };
        }
        await account.update(parsed.value, { transaction });
        if (account.is_default) await clearOtherDefaults(db.CompanyBankAccount, account.id, transaction);
        return { account };
      });
      if (result.notFound) return res.status(404).json({ error: "Cuenta bancaria no encontrada." });
      if (result.conflict) return res.status(409).json({ error: "Ya existe una cuenta con ese CBU." });

      await recordAudit({ entityType: "CompanyBankAccount", entityId: result.account.id, action: "update", newValue: result.account.bank_name, userId: req.user && req.user.id });
      return res.status(200).json({ data: result.account });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  deleteBankAccount: async (req, res) => {
    try {
      const account = await db.CompanyBankAccount.findByPk(req.params.id);
      if (!account) return res.status(404).json({ error: "Cuenta bancaria no encontrada." });
      try {
        await account.destroy();
      } catch (error) {
        if (error.name === "SequelizeForeignKeyConstraintError") {
          return res.status(409).json({ error: "La cuenta está usada en facturas. Desactivala en lugar de eliminarla." });
        }
        throw error;
      }
      await recordAudit({ entityType: "CompanyBankAccount", entityId: account.id, action: "delete", previousValue: account.bank_name, userId: req.user && req.user.id });
      return res.status(200).json({ data: { id: account.id } });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // --- ARCA ---
  // POST /company-settings/arca/test — "Probar conexión". Hace red: FEDummy, login, puntos de venta, último autorizado y cotización.
  testArcaConnection: async (req, res) => {
    try {
      const result = await arca.testConnection();
      return res.status(200).json({ data: result });
    } catch (error) {
      return sendArcaError(res, error);
    }
  },

  // POST /company-settings/arca/validate-points-of-sale — "Validar con ARCA".
  validateArcaPointsOfSale: async (req, res) => {
    try {
      const result = await arca.validatePointsOfSale();
      return res.status(200).json({ data: result });
    } catch (error) {
      return sendArcaError(res, error);
    }
  },
};

function parsePointOfSale(body, isCreate) {
  const value = {};

  if (body.number !== undefined || isCreate) {
    const number = Number(body.number);
    if (!Number.isInteger(number) || number < 1 || number > 99999) {
      return { error: "El número de punto de venta tiene que ser un entero entre 1 y 99999." };
    }
    value.number = number;
  }
  if (body.type !== undefined) {
    if (!POS_TYPES.includes(body.type)) return { error: "Tipo de punto de venta inválido." };
    value.type = body.type;
  }
  if (body.usage_description !== undefined) value.usage_description = cleanText(body.usage_description, 150);
  if (body.address !== undefined) value.address = cleanText(body.address, 255);
  if (body.is_default !== undefined) value.is_default = Boolean(body.is_default);
  if (body.is_active !== undefined) value.is_active = Boolean(body.is_active);

  // Un punto inactivo no puede ser el predeterminado (se ofrecería al emitir sin poder usarse).
  if (value.is_active === false) value.is_default = false;
  if (value.is_default === true && value.is_active === undefined) value.is_active = true;
  return { value };
}

function parseBankAccount(body, isCreate) {
  const value = {};

  if (body.bank_name !== undefined || isCreate) {
    const name = cleanText(body.bank_name, 100);
    if (!name) return { error: "El banco es obligatorio." };
    value.bank_name = name;
  }
  if (body.cbu !== undefined || isCreate) {
    const cbu = normalizeCbu(body.cbu);
    if (!cbu || !/^\d{22}$/.test(cbu)) return { error: "El CBU tiene que tener 22 dígitos." };
    if (!isValidCbu(cbu)) return { error: "El CBU no es válido: no coinciden los dígitos verificadores." };
    value.cbu = cbu;
  }
  if (body.alias !== undefined) {
    const alias = cleanText(body.alias, 20);
    if (alias !== null && !isValidCbuAlias(alias)) {
      return { error: "El alias tiene que tener entre 6 y 20 caracteres: letras, números, punto o guion." };
    }
    value.alias = alias;
  }
  if (body.currency !== undefined) {
    if (body.currency !== null && body.currency !== "" && !CURRENCIES.includes(body.currency)) {
      return { error: "Moneda inválida (ARS o USD)." };
    }
    value.currency = body.currency || null;
  }
  if (body.is_default !== undefined) value.is_default = Boolean(body.is_default);
  if (body.is_active !== undefined) value.is_active = Boolean(body.is_active);
  if (value.is_active === false) value.is_default = false;
  if (value.is_default === true && value.is_active === undefined) value.is_active = true;
  return { value };
}
