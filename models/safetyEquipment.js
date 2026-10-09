"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class SafetyEquipment extends Model {
    static associate(models) {
      SafetyEquipment.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      SafetyEquipment.belongsTo(models.EppItem, { foreignKey: "epp_item_id", as: "eppItem" });
      SafetyEquipment.belongsTo(models.User, { foreignKey: "delivered_by", as: "deliveredBy" });
      SafetyEquipment.belongsTo(models.SafetyEquipment, { foreignKey: "previous_record_id", as: "previousRecord" });
      SafetyEquipment.belongsTo(models.User, { foreignKey: "renewed_by", as: "renewedBy" });
    }
  }
  SafetyEquipment.init({
    employee_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Employees", key: "id" },
    },
    epp_item_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "EppItems", key: "id" },
    },
    size_delivered: {
      type: DataTypes.STRING(10),
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    delivered_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
    },
    return_date: {
      type: DataTypes.DATEONLY,
    },
    condition: {
      type: DataTypes.ENUM("new", "good", "worn", "damaged"),
    },
    delivered_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    notes: {
      type: DataTypes.TEXT,
    },
    signature_url: {
      type: DataTypes.STRING(500),
    },
    signature_key: {
      type: DataTypes.STRING(500),
    },
    signature_name: {
      type: DataTypes.STRING(255),
    },
    expiration_date: {
      type: DataTypes.DATEONLY,
    },
    notify_days_before: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 15,
    },
    alert_status: {
      type: DataTypes.ENUM("pending", "warned", "expired_warned", "renewed"),
      allowNull: false,
      defaultValue: "pending",
    },
    previous_record_id: {
      type: DataTypes.INTEGER,
      references: { model: "SafetyEquipments", key: "id" },
    },
    renewed_at: {
      type: DataTypes.DATE,
    },
    renewed_by: {
      type: DataTypes.INTEGER,
      references: { model: "Users", key: "id" },
    },
    // Virtual field for real-time status, same pattern as EntityDocument.computed_status
    computed_status: {
      type: DataTypes.VIRTUAL,
      get() {
        const alertStatus = this.getDataValue("alert_status");
        if (alertStatus === "renewed") return "renewed";

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
  }, {
    sequelize,
    modelName: "SafetyEquipment",
    tableName: "SafetyEquipments",
    timestamps: true,
    paranoid: true,
    underscored: true,
  });
  return SafetyEquipment;
};
