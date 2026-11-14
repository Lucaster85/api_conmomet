"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Consulta que llega por el formulario de contacto de la web institucional (ver FLOWS.md §58).
// Antes solo intentaba mandar un mail y, sin servidor de mails, se perdía: ahora se guarda.
//
// Se crea únicamente desde el endpoint público (sin usuario), por eso no hay `created_by` ni
// permiso `_write`. Los datos del visitante se guardan tal cual, sin pasar por ninguna entidad
// del sistema: no se convierte en Cliente ni en Pedido de Cotización.
//
// paranoid: borrar una consulta es un soft delete, igual que el resto de los módulos.
module.exports = () => {
  class ContactInquiry extends Model {
    static associate(models) {
      ContactInquiry.belongsTo(models.User, { foreignKey: "handled_by", as: "handledByUser" });
      ContactInquiry.belongsTo(models.User, { foreignKey: "closed_by", as: "closedByUser" });
    }
  }
  ContactInquiry.init(
    {
      reason: {
        type: DataTypes.ENUM("budget_request", "general", "supplier", "other"),
        allowNull: false,
      },
      name: { type: DataTypes.STRING(120), allowNull: false },
      company: { type: DataTypes.STRING(150), allowNull: true },
      phone: { type: DataTypes.STRING(40), allowNull: true },
      email: { type: DataTypes.STRING(150), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: false },
      status: {
        type: DataTypes.ENUM("new", "in_progress", "closed"),
        allowNull: false,
        defaultValue: "new",
      },
      internal_notes: { type: DataTypes.TEXT, allowNull: true },
      handled_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      handled_at: { type: DataTypes.DATE, allowNull: true },
      closed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      closed_at: { type: DataTypes.DATE, allowNull: true },
      source_ip: { type: DataTypes.STRING(64), allowNull: true, comment: "Para rastrear abuso" },
      user_agent: { type: DataTypes.STRING(255), allowNull: true, comment: "Para rastrear abuso" },
    },
    {
      sequelize,
      modelName: "ContactInquiry",
      tableName: "ContactInquiries",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return ContactInquiry;
};
