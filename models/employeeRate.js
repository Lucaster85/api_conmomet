"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EmployeeRate extends Model {
    static associate(models) {
      EmployeeRate.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      EmployeeRate.belongsTo(models.PayrollConcept, { foreignKey: "concept_id", as: "concept" });
    }
  }
  EmployeeRate.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    concept_id: {
      type: DataTypes.INTEGER,
      allowNull: true, // null for mensualizados (sueldo base row)
      references: { model: "PayrollConcepts", key: "id" },
    },
    rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      comment: "Tarifa total (gremio + acuerdo particular) o sueldo mensual",
    },
    guild_rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      comment: "Tarifa base del gremio (sin acuerdo). Se usa para feriados.",
    },
    snr_amount: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      comment: "Monto SNR por quincena (varía por empleado)",
    },
    extras_rate: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: true,
      comment: "Tarifa de extras para mensualizados (cuando no se deriva)",
    },
  }, {
    sequelize,
    modelName: "EmployeeRate",
    tableName: "EmployeeRates",
    timestamps: true,
    underscored: true,
  });
  return EmployeeRate;
};
