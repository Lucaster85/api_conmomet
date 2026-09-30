"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ProjectHourBudget extends Model {
    static associate(models) {
      ProjectHourBudget.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      ProjectHourBudget.belongsTo(models.BudgetItemType, { foreignKey: "budget_item_type_id", as: "itemType" });
    }
  }
  ProjectHourBudget.init({
    project_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Projects", key: "id" },
    },
    budget_item_type_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "BudgetItemTypes", key: "id" },
      comment: "NULL = bolsa \"Generales\" (horas sin rubro) — no es un rubro más del catálogo.",
    },
    budgeted_hours: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      defaultValue: 0,
    },
  }, {
    sequelize,
    modelName: "ProjectHourBudget",
    tableName: "ProjectHourBudgets",
    timestamps: true,
    underscored: true,
    // Sin paranoid: es un contador (bolsa presupuestada por rubro), no un registro de auditoría —
    // el detalle de qué se cargó vive en TimeEntry. Reemplaza a Project.budgeted_hours (un único
    // total) — ver FLOWS.md.
  });
  return ProjectHourBudget;
};
