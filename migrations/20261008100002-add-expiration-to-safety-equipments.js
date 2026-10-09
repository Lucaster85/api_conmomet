"use strict";
const { DataTypes } = require("sequelize");

/**
 * Vencimiento y renovación de una entrega de EPP (ver FLOWS.md §33). `expiration_date` y
 * `notify_days_before` son un snapshot al momento de la entrega (copiados del artículo, pero
 * editables por entrega). `alert_status` distingue "renewed" (se le entregó uno nuevo del mismo
 * artículo) de los estados de aviso que calcula `computed_status` (VIRTUAL, ver
 * models/safetyEquipment.js), igual que EntityDocument. `previous_record_id` encadena la
 * renovación con la entrega que reemplaza.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("SafetyEquipments", "expiration_date", {
      type: DataTypes.DATEONLY,
      allowNull: true,
    });
    await queryInterface.addColumn("SafetyEquipments", "notify_days_before", {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 15,
    });
    await queryInterface.addColumn("SafetyEquipments", "alert_status", {
      type: DataTypes.ENUM("pending", "warned", "expired_warned", "renewed"),
      allowNull: false,
      defaultValue: "pending",
    });
    await queryInterface.addColumn("SafetyEquipments", "previous_record_id", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "SafetyEquipments", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
    await queryInterface.addColumn("SafetyEquipments", "renewed_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("SafetyEquipments", "renewed_by", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addIndex("SafetyEquipments", ["employee_id", "epp_item_id", "alert_status"], {
      name: "safety_equipments_employee_item_alert",
    });
    await queryInterface.addIndex("SafetyEquipments", ["expiration_date", "alert_status"], {
      name: "safety_equipments_expiration_alert",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeIndex("SafetyEquipments", "safety_equipments_expiration_alert");
    await queryInterface.removeIndex("SafetyEquipments", "safety_equipments_employee_item_alert");
    await queryInterface.removeColumn("SafetyEquipments", "renewed_by");
    await queryInterface.removeColumn("SafetyEquipments", "renewed_at");
    await queryInterface.removeColumn("SafetyEquipments", "previous_record_id");
    await queryInterface.removeColumn("SafetyEquipments", "alert_status");
    await queryInterface.removeColumn("SafetyEquipments", "notify_days_before");
    await queryInterface.removeColumn("SafetyEquipments", "expiration_date");
  },
};
