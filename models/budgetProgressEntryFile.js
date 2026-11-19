"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// Archivo del certificado de un avance real de obra.
module.exports = () => {
  class BudgetProgressEntryFile extends Model {
    static associate(models) {
      BudgetProgressEntryFile.belongsTo(models.BudgetProgressEntry, { foreignKey: "progress_entry_id", as: "entry" });
      BudgetProgressEntryFile.belongsTo(models.User, { foreignKey: "uploaded_by", as: "uploader" });
    }
  }
  BudgetProgressEntryFile.init({
    progress_entry_id: { type: DataTypes.INTEGER, allowNull: false, references: { model: "BudgetProgressEntries", key: "id" } },
    file_url: { type: DataTypes.STRING(500), allowNull: false },
    file_key: { type: DataTypes.STRING(500), allowNull: true },
    file_name: { type: DataTypes.STRING(255), allowNull: true },
    mime_type: { type: DataTypes.STRING(120), allowNull: true },
    size_bytes: { type: DataTypes.INTEGER, allowNull: true },
    uploaded_by: { type: DataTypes.INTEGER, allowNull: false, references: { model: "Users", key: "id" } },
  }, {
    sequelize, modelName: "BudgetProgressEntryFile", tableName: "BudgetProgressEntryFiles", timestamps: true, paranoid: true, underscored: true,
  });
  return BudgetProgressEntryFile;
};
