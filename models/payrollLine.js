"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class PayrollLine extends Model {
    static associate(models) {
      PayrollLine.belongsTo(models.PayrollEntry, { foreignKey: "payroll_entry_id", as: "payrollEntry" });
      PayrollLine.belongsTo(models.PayrollConcept, { foreignKey: "concept_id", as: "concept" });
      PayrollLine.belongsTo(models.PayPeriod, { foreignKey: "source_period_id", as: "sourcePeriod" });
    }
  }
  PayrollLine.init({
    payroll_entry_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "PayrollEntries", key: "id" },
    },
    concept_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "PayrollConcepts", key: "id" },
    },
    label: {
      type: DataTypes.STRING(150),
      allowNull: false,
      comment: "Texto visible: Hs comunes, Extras Hs grúa, Retro 1Q Mar, etc.",
    },
    quantity: {
      type: DataTypes.DECIMAL(8, 2),
      allowNull: false,
      defaultValue: 1,
    },
    rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
    },
    subtotal: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
    },
    line_type: {
      type: DataTypes.ENUM("regular", "extras_50", "extras_100", "holiday", "fixed", "retroactive", "vacation", "medical_leave", "justified", "medical_leave_deduction", "vacation_deduction", "absence_deduction", "sac", "sac_adjustment", "final_days", "sac_proportional", "vacation_unused", "vacation_unused_sac", "notice_pay", "notice_pay_sac", "month_integration", "month_integration_sac", "severance", "severance_agreed", "overpaid_deduction", "employee_notice_deduction"),
      allowNull: false,
      defaultValue: "regular",
    },
    source_period_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "PayPeriods", key: "id" },
      comment: "FK a PayPeriod de origen, solo para líneas retroactivas",
    },
    // Solo liquidación final (PLAN_EGRESOS.md §6.1): lo que propuso el cálculo, por qué se corrigió el
    // monto, y qué concepto es (para que regenerar respete lo editado).
    suggested_amount: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
    edit_reason: { type: DataTypes.TEXT, allowNull: true },
    item_key: { type: DataTypes.STRING(60), allowNull: true },
  }, {
    sequelize,
    modelName: "PayrollLine",
    tableName: "PayrollLines",
    timestamps: true,
    underscored: true,
  });
  return PayrollLine;
};
