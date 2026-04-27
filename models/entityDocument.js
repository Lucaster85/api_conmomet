"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EntityDocument extends Model {
    static associate(models) {
      EntityDocument.belongsTo(models.User, { foreignKey: "uploaded_by", as: "uploader" });
      EntityDocument.belongsTo(models.User, { foreignKey: "resolved_by", as: "resolver" });
      EntityDocument.belongsTo(models.EntityDocument, { foreignKey: "previous_record_id", as: "previousRecord" });
      // Note: We don't define strong belongsTo associations for employee, vehicle, etc.
      // to keep it decoupled as per the polymorphic design. The frontend/controllers will handle joining if needed.
    }
  }
  EntityDocument.init(
    {
      title: {
        type: DataTypes.STRING(150),
        allowNull: false,
      },
      notes: {
        type: DataTypes.TEXT,
      },
      entity_type: {
        type: DataTypes.ENUM("employee", "vehicle", "project", "company"),
        allowNull: false,
      },
      entity_id: {
        type: DataTypes.INTEGER,
      },
      file_url: {
        type: DataTypes.STRING(500),
      },
      file_key: {
        type: DataTypes.STRING(500),
      },
      file_name: {
        type: DataTypes.STRING(255),
      },
      expiration_date: {
        type: DataTypes.DATEONLY,
      },
      notify_days_before: {
        type: DataTypes.INTEGER,
        defaultValue: 15,
      },
      alert_status: {
        type: DataTypes.ENUM("pending", "warned", "expired_warned", "resolved"),
        defaultValue: "pending",
      },
      resolved_at: {
        type: DataTypes.DATE,
      },
      resolved_by: {
        type: DataTypes.INTEGER,
        references: { model: "Users", key: "id" },
      },
      uploaded_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
      },
      is_renewable: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      previous_record_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "EntityDocuments", key: "id" },
      },
      // Virtual field for real-time status
      computed_status: {
        type: DataTypes.VIRTUAL,
        get() {
          const alertStatus = this.getDataValue("alert_status");
          if (alertStatus === "resolved") return "resolved";

          const expDate = this.getDataValue("expiration_date");
          if (!expDate) return "permanent";

          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const expiration = new Date(expDate + "T00:00:00"); // Ensure local timezone parsing ignores time
          const notifyDays = this.getDataValue("notify_days_before") || 15;

          const diffTime = expiration.getTime() - today.getTime();
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays < 0) return "expired";
          if (diffDays <= notifyDays) return "expiring_soon";
          return "valid";
        },
      },
    },
    {
      sequelize,
      modelName: "EntityDocument",
      tableName: "EntityDocuments",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return EntityDocument;
};
