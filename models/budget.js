"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Budget extends Model {
    static associate(models) {
      Budget.belongsTo(models.Client, { foreignKey: "client_id", as: "client" });
      Budget.belongsTo(models.Plant, { foreignKey: "plant_id", as: "plant" });
      Budget.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      Budget.belongsTo(models.Project, { foreignKey: "parent_project_id", as: "parentProject" });
      Budget.belongsTo(models.Project, { foreignKey: "existing_project_id", as: "existingProject" });
      Budget.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
      Budget.belongsTo(models.User, { foreignKey: "approved_by", as: "approvedBy" });
      Budget.belongsTo(models.ClientSupervisor, { foreignKey: "approved_by_supervisor_id", as: "approvedBySupervisor" });
      Budget.hasMany(models.BudgetLaborLine, { foreignKey: "budget_id", as: "laborLines" });
      Budget.hasMany(models.BudgetMaterialItem, { foreignKey: "budget_id", as: "materialItems" });
    }
  }
  Budget.init({
    number: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true,
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    client_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Clients", key: "id" },
    },
    plant_id: {
      type: DataTypes.INTEGER,
      references: { model: "Plants", key: "id" },
    },
    status: {
      type: DataTypes.ENUM("draft", "sent", "approved", "rejected"),
      allowNull: false,
      defaultValue: "draft",
    },
    currency: {
      type: DataTypes.ENUM("ARS", "USD"),
      allowNull: false,
      defaultValue: "ARS",
      comment: "Moneda por defecto del presupuesto. Cada línea puede overridearla individualmente.",
    },
    parent_project_id: {
      type: DataTypes.INTEGER,
      references: { model: "Projects", key: "id" },
      comment: "Si el presupuesto es un adicional de un proyecto existente",
    },
    project_id: {
      type: DataTypes.INTEGER,
      references: { model: "Projects", key: "id" },
      comment: "Proyecto/subproyecto generado (o vinculado) al aprobar este presupuesto",
    },
    existing_project_id: {
      type: DataTypes.INTEGER,
      references: { model: "Projects", key: "id" },
      comment: "Proyecto raíz ya existente al que este presupuesto se vincula sin generar uno nuevo (mutuamente excluyente con parent_project_id)",
    },
    description: {
      type: DataTypes.TEXT,
    },
    start_date: {
      type: DataTypes.DATEONLY,
      comment: "Fecha de inicio prevista del proyecto — se traslada al Project al generar/vincular",
    },
    end_date: {
      type: DataTypes.DATEONLY,
    },
    validity_days: {
      type: DataTypes.INTEGER,
      defaultValue: 15,
      comment: "Días de vigencia desde sent_at. Solo informativo/advertencia — no bloquea aprobar un presupuesto vencido.",
    },
    sent_at: {
      type: DataTypes.DATE,
    },
    approved_at: {
      type: DataTypes.DATE,
    },
    rejected_at: {
      type: DataTypes.DATE,
    },
    rejection_reason: {
      type: DataTypes.TEXT,
    },
    approved_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    approved_document_url: {
      type: DataTypes.STRING(500),
      comment: "Documento firmado subido a R2 al aprobar (opcional)",
    },
    approved_by_supervisor_id: {
      type: DataTypes.INTEGER,
      references: { model: "ClientSupervisors", key: "id" },
      comment: "Quién aprobó del lado del cliente (contacto externo, opcional) — distinto de approved_by, que es el usuario interno que cargó la aprobación",
    },
    notes: {
      type: DataTypes.TEXT,
    },
    work_order_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
      comment: "N° de OT libre que asigna el cliente — solo para rastreo, no se valida formato ni unicidad",
    },
    labor_discount_percent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
      comment: "Bonificación % sobre el subtotal de mano de obra, aplicable desde 'sent' en adelante",
    },
    material_discount_percent: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: 0,
      comment: "Bonificación % sobre el subtotal de materiales, aplicable desde 'sent' en adelante",
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "Budget",
    tableName: "Budgets",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return Budget;
};
