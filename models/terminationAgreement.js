"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class TerminationAgreement extends Model {
    static associate(models) {
      TerminationAgreement.belongsTo(models.EmployeeTermination, { foreignKey: "termination_id", as: "termination" });
      TerminationAgreement.hasMany(models.TerminationAgreementInstallment, { foreignKey: "agreement_id", as: "installments" });
      TerminationAgreement.belongsTo(models.User, { foreignKey: "created_by", as: "createdBy" });
    }
  }
  TerminationAgreement.init(
    {
      termination_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "EmployeeTerminations", key: "id" } },
      total_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      agreement_date: { type: DataTypes.DATEONLY, allowNull: false },
      homologated: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      status: { type: DataTypes.ENUM("active", "cancelled"), allowNull: false, defaultValue: "active" },
      cancelled_at: { type: DataTypes.DATE, allowNull: true },
      cancelled_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      cancellation_reason: { type: DataTypes.TEXT, allowNull: true },
      created_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
    },
    { sequelize, modelName: "TerminationAgreement", tableName: "TerminationAgreements", timestamps: true, underscored: true }
  );
  return TerminationAgreement;
};
