const db = require("../models");
const { normalizeCuit, isValidCuit } = require("../helpers/cuit");

const TAX_CONDITIONS = ["responsable_inscripto", "monotributo", "exento", "consumidor_final", "no_responsable"];

// Normaliza y valida los datos fiscales opcionales. Devuelve { cuit, taxCondition } con null donde
// el valor viene vacío, o { error } si alguno es inválido. `undefined` = el campo no vino (no se toca).
function parseFiscalData({ cuit, tax_condition }) {
  const result = {};
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
            await client.save();

            res.status(200).json(client);
        } catch (error) {
            res.status(500).json({"error": error.message});
        }
    },
}