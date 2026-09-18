"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Fila única (id: 1, por convención de la app — no hay más de una fila nunca). Configuración de
// negocio editable sin re-deploy. Si hace falta otro parámetro configurable más adelante, se
// agrega como columna nueva vía migración, mismo patrón que el resto del proyecto — no hace
// falta un esquema key-value genérico para esto.
module.exports = () => {
  class SystemSetting extends Model {
    static associate(models) {
      SystemSetting.belongsTo(models.User, { foreignKey: "oca_budget_notification_user_id", as: "ocaBudgetNotificationUser" });
    }
  }
  SystemSetting.init({
    max_loan_amount_ars: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      defaultValue: 1000000,
    },
    oca_budget_notification_user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      comment: "Usuario que ve el aviso de OCAs aprobadas pendientes de presupuesto en su dashboard.",
    },
  }, {
    sequelize,
    modelName: "SystemSetting",
    tableName: "SystemSettings",
    timestamps: true,
    underscored: true,
  });
  return SystemSetting;
};
