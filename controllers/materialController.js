const { Op } = require("sequelize");
const ExcelJS = require("exceljs");
const db = require("../models");
const { userHasPermission } = require("../helpers");

function stripCost(material) {
  const { current_cost, currency, ...rest } = material;
  return rest;
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { q, is_active } = req.query;
      const where = {};
      if (is_active !== undefined) where.is_active = is_active === "true";
      if (q) where.description = { [Op.like]: `%${q}%` };

      const materials = await db.Material.findAll({
        where,
        include: [{ model: db.MaterialUnit, as: "materialUnit" }],
        order: [["description", "ASC"]],
      });

      const canSeeCosts = userHasPermission(req.user, "material_costs_read");
      const data = materials.map((m) => {
        const json = m.toJSON();
        return canSeeCosts ? json : stripCost(json);
      });

      return res.status(200).json({ data });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
      const { description, material_unit_id, current_cost, currency, is_active } = req.body;
      if (!description || !material_unit_id) {
        await transaction.rollback();
        return res.status(400).json({ error: "Descripción y unidad son obligatorias." });
      }

      const canSeeCosts = userHasPermission(req.user, "material_costs_read");
      const finalCost = canSeeCosts ? (current_cost ?? null) : null;
      const finalCurrency = canSeeCosts ? (currency || null) : null;

      const material = await db.Material.create({
        description,
        material_unit_id,
        current_cost: finalCost,
        currency: finalCurrency,
        is_active: is_active !== undefined ? is_active : true,
      }, { transaction });

      // Primera entrada de historial — solo si nace con costo cargado.
      if (finalCost !== null && finalCost !== undefined) {
        await db.MaterialCostHistory.create({
          material_id: material.id,
          cost: finalCost,
          currency: finalCurrency || "ARS",
          changed_by: req.user.id,
        }, { transaction });
      }

      await transaction.commit();

      const fullMaterial = await db.Material.findByPk(material.id, { include: [{ model: db.MaterialUnit, as: "materialUnit" }] });
      const json = fullMaterial.toJSON();
      return res.status(201).json({ data: canSeeCosts ? json : stripCost(json) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    const transaction = await db.sequelize.transaction();
    try {
      const material = await db.Material.findByPk(req.params.id, { transaction });
      if (!material) {
        await transaction.rollback();
        return res.status(404).json({ error: "Material no encontrado." });
      }

      const { description, material_unit_id, current_cost, currency, is_active } = req.body;
      const canSeeCosts = userHasPermission(req.user, "material_costs_read");

      const newCost = canSeeCosts && current_cost !== undefined ? current_cost : material.current_cost;
      const newCurrency = canSeeCosts && currency !== undefined ? currency : material.currency;

      // Entrada de historial SOLO si el costo efectivamente cambió — no en cada guardado.
      if (canSeeCosts && current_cost !== undefined) {
        const oldVal = material.current_cost !== null && material.current_cost !== undefined ? parseFloat(material.current_cost) : null;
        const newVal = newCost !== null && newCost !== undefined ? parseFloat(newCost) : null;
        const changed = oldVal !== newVal || (material.currency || null) !== (newCurrency || null);
        if (changed && newVal !== null) {
          await db.MaterialCostHistory.create({
            material_id: material.id,
            cost: newVal,
            currency: newCurrency || "ARS",
            changed_by: req.user.id,
          }, { transaction });
        }
      }

      await material.update({
        description: description !== undefined ? description : material.description,
        material_unit_id: material_unit_id !== undefined ? material_unit_id : material.material_unit_id,
        current_cost: newCost,
        currency: newCurrency,
        is_active: is_active !== undefined ? is_active : material.is_active,
      }, { transaction });

      await transaction.commit();

      const fullMaterial = await db.Material.findByPk(material.id, { include: [{ model: db.MaterialUnit, as: "materialUnit" }] });
      const json = fullMaterial.toJSON();
      return res.status(200).json({ data: canSeeCosts ? json : stripCost(json) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  getCostHistory: async (req, res) => {
    try {
      // La ruta anidada resuelve el permiso genérico "materials_read" (por path) — el costo
      // en sí necesita el permiso más estricto, chequeado acá a mano.
      if (!userHasPermission(req.user, "material_costs_read")) {
        return res.status(403).json({ error: "No tiene permiso para ver el historial de costos." });
      }

      const material = await db.Material.findByPk(req.params.id);
      if (!material) return res.status(404).json({ error: "Material no encontrado." });

      const history = await db.MaterialCostHistory.findAll({
        where: { material_id: material.id },
        include: [{ model: db.User, as: "changedBy", attributes: ["id", "name", "lastname"] }],
        order: [["created_at", "DESC"]],
      });

      return res.status(200).json({ data: history });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const material = await db.Material.findByPk(req.params.id);
      if (!material) return res.status(404).json({ error: "Material no encontrado." });

      const usageCount = await db.BudgetMaterialItem.count({ where: { material_id: material.id } });
      if (usageCount > 0) {
        return res.status(400).json({ error: `No se puede eliminar: está usado en ${usageCount} línea(s) de presupuesto. Desactívelo en su lugar.` });
      }

      await material.destroy();
      return res.status(200).json({ message: "Material eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Parseo "stateless" de Excel del catálogo de materiales — no persiste nada, solo
  // devuelve filas de previsualización (mismo criterio que budgetController.importMaterials).
  importPreview: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Debe subir un archivo .xlsx/.xls." });
      }

      const canSeeCosts = userHasPermission(req.user, "material_costs_read");

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return res.status(400).json({ error: "El archivo no tiene hojas." });
      }

      const headers = [];
      worksheet.getRow(1).eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value != null ? String(cell.value) : "";
      });

      const rawRows = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const rowObj = {};
        row.eachCell((cell, colNumber) => {
          if (headers[colNumber]) rowObj[headers[colNumber]] = cell.value;
        });
        if (Object.keys(rowObj).length > 0) rawRows.push(rowObj);
      });

      const normalizeKey = (key) => key
        .toString()
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

      const COLUMN_ALIASES = {
        description: ["material", "descripcion", "detalle", "item", "producto"],
        unit: ["unidad", "u", "um"],
        cost: ["costo", "precio", "precio costo", "costo unitario", "cost"],
        currency: ["moneda", "currency"],
      };

      const rows = rawRows.map((rawRow) => {
        const normalizedRow = {};
        for (const [key, value] of Object.entries(rawRow)) {
          normalizedRow[normalizeKey(key)] = value;
        }

        const findValue = (aliases) => {
          for (const alias of aliases) {
            if (normalizedRow[alias] !== undefined) return normalizedRow[alias];
          }
          return null;
        };

        const currencyRaw = (findValue(COLUMN_ALIASES.currency) || "").toString().trim().toUpperCase();
        const currency = ["ARS", "USD"].includes(currencyRaw) ? currencyRaw : null;

        return {
          description: findValue(COLUMN_ALIASES.description) || "",
          unit: findValue(COLUMN_ALIASES.unit) || "u",
          cost: canSeeCosts ? (parseFloat(findValue(COLUMN_ALIASES.cost)) || null) : null,
          currency: canSeeCosts ? currency : null,
        };
      }).filter((row) => row.description);

      return res.status(200).json({ data: rows });
    } catch (error) {
      return res.status(500).json({ error: `No se pudo leer el archivo: ${error.message}` });
    }
  },
};
