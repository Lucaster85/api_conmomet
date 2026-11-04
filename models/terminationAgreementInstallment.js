"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class TerminationAgreementInstallment extends Model {
    static associate(models) {
      TerminationAgreementInstallment.belongsTo(models.TerminationAgreement, { foreignKey: "agreement_id", as: "agreement" });
      TerminationAgreementInstallment.belongsTo(models.User, { foreignKey: "paid_by", as: "paidBy" });
    }
  }
  TerminationAgreementInstallment.init(
    {
      agreement_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "TerminationAgreements", key: "id" } },
      installment_number: { type: DataTypes.INTEGER, allowNull: false },
      due_date: { type: DataTypes.DATEONLY, allowNull: false },
      amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
      paid_at: { type: DataTypes.DATEONLY, allowNull: true },
      payment_method: { type: DataTypes.ENUM("efectivo", "transferencia"), allowNull: true },
      paid_by: { type: DataTypes.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      payment_proof_url: { type: DataTypes.STRING(500), allowNull: true },
      payment_proof_key: { type: DataTypes.STRING(500), allowNull: true },
      payment_proof_name: { type: DataTypes.STRING(255), allowNull: true },
      signature_url: { type: DataTypes.STRING(500), allowNull: true },
      signature_key: { type: DataTypes.STRING(500), allowNull: true },
      signature_name: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      sequelize,
      modelName: "TerminationAgreementInstallment",
      tableName: "TerminationAgreementInstallments",
      timestamps: true,
      underscored: true,
    }
  );
  return TerminationAgreementInstallment;
};
