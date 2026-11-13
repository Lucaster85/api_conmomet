"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class ProjectManualHour extends Model {
    static associate(models) {
      ProjectManualHour.belongsTo(models.Project, { foreignKey: "project_id", as: "project" });
      ProjectManualHour.belongsTo(models.BudgetItemType, { foreignKey: "budget_item_type_id", as: "itemType" });
      ProjectManualHour.belongsTo(models.User, { foreignKey: "created_by", as: "author" });
      ProjectManualHour.belongsTo(models.User, { foreignKey: "voided_by", as: "voider" });
    }
  }
  ProjectManualHour.init({
    project_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Projects", key: "id" },
    },
    budget_item_type_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "BudgetItemTypes", key: "id" },
      comment: "NULL = bolsa \"Generales\" (horas sin rubro).",
    },
    hours: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
    },
    date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM("active", "voided"),
      allowNull: false,
      defaultValue: "active",
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    voided_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    },
    voided_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    void_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  }, {
    sequelize,
    modelName: "ProjectManualHour",
    tableName: "ProjectManualHours",
    timestamps: true,
    underscored: true,
    // Sin paranoid: no se borra, se anula con motivo (status 'voided') y queda visible. FLOWS.md §56.
  });
  return ProjectManualHour;
};
