"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class QuoteRequestFile extends Model {
    static associate(models) {
      QuoteRequestFile.belongsTo(models.QuoteRequest, { foreignKey: "quote_request_id", as: "quoteRequest" });
      QuoteRequestFile.belongsTo(models.User, { foreignKey: "uploaded_by", as: "uploader" });
    }
  }
  QuoteRequestFile.init({
    quote_request_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "QuoteRequests", key: "id" },
    },
    file_url: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    file_key: {
      type: DataTypes.STRING(500),
    },
    file_name: {
      type: DataTypes.STRING(255),
      comment: "Nombre original del archivo (a diferencia de Budget.approved_document_url, acá se preserva para mostrarlo en la UI)",
    },
    mime_type: {
      type: DataTypes.STRING(120),
    },
    size_bytes: {
      type: DataTypes.INTEGER,
    },
    uploaded_by: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
  }, {
    sequelize,
    modelName: "QuoteRequestFile",
    tableName: "QuoteRequestFiles",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return QuoteRequestFile;
};
