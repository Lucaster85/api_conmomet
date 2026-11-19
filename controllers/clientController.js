const db = require("../models");
const { normalizeCuit, isValidCuit } = require("../helpers/cuit");
const padron = require("../services/arca/padron");
const { ArcaError } = require("../services/arca/errors");

const TAX_CONDITIONS = ["responsable_inscripto", "monotributo", "exento", "consumidor_final", "no_responsable"];

// Normaliza y valida los datos fiscales opcionales. Devuelve { cuit, taxCondition } con null donde
// el valor viene vacío, o { error } si alguno es inválido. `undefined` = el campo no vino (no se toca).
function parseFiscalData({ cuit, tax_condition, fiscal_street, fiscal_locality, fiscal_province, fce_transfer_option }) {
  const result = {};
  // Opción de transferencia de la FCE propia del cliente (SCA o ADC). Vacío = usa la de la empresa.
  if (fce_transfer_option !== undefined) {
    const option = fce_transfer_option === "" ? null : fce_transfer_option;
    if (option !== null && !["SCA", "ADC"].includes(option)) {
      return { error: "La opción de transferencia de la FCE no es válida (SCA o ADC)." };
    }
    result.fce_transfer_option = option;
  }
  // Domicilio comercial fiscal (el del padrón de ARCA): texto libre opcional. Sale en el bloque del receptor de la factura.
  for (const [key, value, max] of [["fiscal_street", fiscal_street, 150], ["fiscal_locality", fiscal_locality, 100], ["fiscal_province", fiscal_province, 100]]) {
    if (value !== undefined) {
      const text = value === null ? "" : String(value).trim();
      result[key] = text === "" ? null : text.slice(0, max);
    }
  }
  if (cuit !== undefined) {
    const normalized = normalizeCuit(cuit);
    if (normalized !== null && !isValidCuit(normalized)) {
      return { error: "El CUIT no es válido: debe tener 11 dígitos y un dígito verificador correcto." };
    }
    result.cuit = normalized;
  }
  if (tax_condition !== undefined) {
    const condition = tax_condition === "" ? null : tax_condition;
    if (condition !== null && !TAX_CONDITIONS.includes(condition)) {
      return { error: "La condición frente al IVA no es válida." };
    }
    result.taxCondition = condition;
  }
  return result;
}

module.exports = {
    // GET /clients/padron/:cuit (solo requirePermission: authPermission pediría también clients_read) — datos de un contribuyente en el padrón A13 de ARCA, para autocompletar el alta o la ficha de un cliente (FLOWS.md §73).
    // Pide clients_write (es para cargar un cliente). Si ya hay un cliente con ese CUIT, lo avisa (`existing_client`).
    padronLookup: async (req, res) => {
        try {
            const cuit = normalizeCuit(req.params.cuit);
            if (!isValidCuit(cuit)) return res.status(400).json({ error: "El CUIT no es válido." });
            const data = await padron.getPersona(cuit);
            const existing = await db.Client.findOne({ where: { cuit }, attributes: ["id", "razonSocial"] });
            return res.status(200).json({ data: { ...data, existing_client: existing ? { id: existing.id, razonSocial: existing.razonSocial } : null } });
        } catch (error) {
            if (error instanceof ArcaError) {
                const status = error.code === "disabled" || error.code === "config" ? 409 : error.code === "input" ? 400 : 502;
                return res.status(status).json({ error: error.message, code: `arca_${error.code}` });
            }
            return res.status(500).json({ error: error.message });
        }
    },

    getAll: async (req, res) => {
        try {
            const { is_active } = req.query;
            const where = {};
            if (is_active !== undefined) {
                where.is_active = is_active === "true" || is_active === true;
            }
            const {count, rows} = await db.Client.findAndCountAll({ where });
            return res.status(200).json({count, data: rows});
        } catch (error) {
            return res.status(500).json({error: error.message});
        }
    },
    get: async (req,res) => {
        const { id } = req.params;

        try {
            const client = await db.Client.findByPk(id);

            if(!client) return res.status(400).json({"error": "Cliente no encontrado."});

            return res.status(200).json({data: client});
        } catch (error) {
            return res.status(500).json({"error": error.message});
        }
    },
    create: async (req, res) => {
        const {razonSocial, email, phone, is_active} = req.body;
        try {
            const fiscal = parseFiscalData(req.body);
            if (fiscal.error) return res.status(400).json({"error": fiscal.error});

            const client = await db.Client.create({
                razonSocial,
                email,
                phone,
                is_active: is_active !== undefined ? is_active : true,
                cuit: fiscal.cuit ?? null,
                tax_condition: fiscal.taxCondition ?? null,
                fce_transfer_option: fiscal.fce_transfer_option ?? null,
                fiscal_street: fiscal.fiscal_street ?? null,
                fiscal_locality: fiscal.fiscal_locality ?? null,
                fiscal_province: fiscal.fiscal_province ?? null,
            });
            return res.status(200).json({client});

        } catch (error) {
            return res.status(400).json({"error": error.message})
        }

    },
    // Update parcial: solo pisa los campos que vienen en el body — necesario para que
    // desactivar/activar un cliente (solo manda is_active) no borre el resto de sus datos.
    update: async (req, res) => {
        const { id } = req.params;
        const { razonSocial, email, phone, is_active } = req.body;

        try {
            const client = await db.Client.findByPk(id);

            if(!client) return res.status(400).json({"error": "Cliente no encontrado."});

            const fiscal = parseFiscalData(req.body);
            if (fiscal.error) return res.status(400).json({"error": fiscal.error});

            if (razonSocial !== undefined) client.razonSocial = razonSocial;
            if (email !== undefined) client.email = email;
            if (phone !== undefined) client.phone = phone;
            if (is_active !== undefined) client.is_active = is_active;
            if (fiscal.cuit !== undefined) client.cuit = fiscal.cuit;
            if (fiscal.taxCondition !== undefined) client.tax_condition = fiscal.taxCondition;
            for (const key of ["fiscal_street", "fiscal_locality", "fiscal_province", "fce_transfer_option"]) {
                if (fiscal[key] !== undefined) client[key] = fiscal[key];
            }
            await client.save();

            res.status(200).json(client);
        } catch (error) {
            res.status(500).json({"error": error.message});
        }
    },
}