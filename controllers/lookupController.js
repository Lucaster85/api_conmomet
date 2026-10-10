const db = require("../models");
const { Op } = require("sequelize");

module.exports = {
  // GET /lookup/roles — solo verifyToken, sin authPermission. Devuelve los roles que el
  // usuario logueado puede asignar (nivel igual o menor al suyo, sin roles técnicos — crear
  // un usuario con tu mismo rol no es escalación, le das exactamente tus mismos permisos),
  // para poblar selects sin requerir roles_read (ver UserForm.tsx).
  roles: async (req, res) => {
    try {
      const actorLevel = req.user.role.level;

      const roles = await db.Role.findAll({
        where: {
          level: { [Op.lte]: actorLevel },
          is_system: false,
        },
        attributes: ["id", "name", "level", "has_dashboard_access"],
        order: [["level", "DESC"]],
      });

      return res.status(200).json({ data: roles });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /lookup/projects — para el combo de Proyecto en Carga de Horas sin requerir
  // projects_read (que destraba el módulo de Proyectos completo). Mismos filtros de negocio
  // que GET /projects, pero solo los campos que un combo necesita.
  projects: async (req, res) => {
    try {
      const { client_id, status, plant_id, include_children, is_additional } = req.query;
      const where = {};
      if (client_id) where.client_id = client_id;
      if (plant_id) where.plant_id = plant_id;
      if (status) where.status = status;
      if (include_children !== "true") where.parent_id = null;
      if (is_additional === "true") where.is_additional = true;
      if (is_additional === "false") where.is_additional = false;

      const projects = await db.Project.findAll({
        where,
        attributes: ["id", "name", "code", "client_id", "plant_id", "is_additional"],
        include: [{ model: db.Project, as: "parent", attributes: ["id", "code"] }],
        order: [["created_at", "DESC"]],
      });
      return res.status(200).json({ data: projects });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /lookup/projects/:id/supervisors — supervisores de un proyecto puntual, sin
  // projects_read. El combo de Supervisor depende del Proyecto elegido (select en cascada).
  projectSupervisors: async (req, res) => {
    try {
      const project = await db.Project.findByPk(req.params.id);
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const supervisors = await project.getSupervisors({
        attributes: ["id", "name", "lastname"],
        through: { attributes: [] },
      });
      return res.status(200).json({ data: supervisors });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /lookup/vehicles — para el combo de Grúa/Vehículo cuando el concepto es de horas de
  // grúa, sin requerir vehicles_read (módulo Flota).
  vehicles: async (req, res) => {
    try {
      const { is_active } = req.query;
      const where = {};
      if (is_active !== undefined) where.is_active = is_active === "true";

      const vehicles = await db.Vehicle.findAll({
        where,
        attributes: ["id", "brand", "model", "plate"],
        order: [["brand", "ASC"], ["model", "ASC"], ["plate", "ASC"]],
      });
      return res.status(200).json({ data: vehicles });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /lookup/holidays — solo se usa para saber si una fecha es feriado, sin requerir
  // holidays_read (módulo Feriados).
  holidays: async (req, res) => {
    try {
      const { year } = req.query;
      const where = {};
      if (year) {
        where.date = { [Op.between]: [`${year}-01-01`, `${year}-12-31`] };
      }
      const holidays = await db.Holiday.findAll({ where, attributes: ["date"], order: [["date", "ASC"]] });
      return res.status(200).json({ data: holidays });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /lookup/budget-item-types — combo de Rubro en Carga de Horas, sin requerir
  // budget_item_types_read (módulo Rubros de Presupuesto).
  budgetItemTypes: async (req, res) => {
    try {
      const { is_active } = req.query;
      const where = {};
      if (is_active !== undefined) where.is_active = is_active === "true";

      const items = await db.BudgetItemType.findAll({
        where,
        attributes: ["id", "name", "unit_type"],
        order: [["display_order", "ASC"], ["name", "ASC"]],
      });
      return res.status(200).json({ data: items });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /lookup/payroll-concepts — combo de Concepto en Carga de Horas, sin requerir
  // payroll_concepts_read (módulo Conceptos de Liquidación).
  payrollConcepts: async (req, res) => {
    try {
      const where = {};
      if (req.query.active === "true") where.is_active = true;
      const concepts = await db.PayrollConcept.findAll({
        where,
        attributes: ["id", "name", "is_crane_hours"],
        order: [["sort_order", "ASC"], ["name", "ASC"]],
      });
      return res.status(200).json({ data: concepts });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /lookup/pay-periods — solo para bloquear carga/anulación en una quincena ya cerrada o
  // pagada, sin requerir pay_periods_read (módulo Quincenas y Pagos).
  payPeriods: async (req, res) => {
    try {
      const periods = await db.PayPeriod.findAll({
        attributes: ["id", "start_date", "end_date", "status"],
        order: [["year", "DESC"], ["month", "DESC"], ["type", "DESC"]],
      });
      return res.status(200).json({ data: periods });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
