"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    // MySQL requiere redefinir el ENUM completo vía MODIFY COLUMN (changeColumn). No muta
    // datos existentes, solo agrega el valor permitido "cancelled" (anular sin destruir el
    // registro, para poder auditarlo después desde el listado).
    await queryInterface.changeColumn("SalaryAdvances", "status", {
      type: DataTypes.ENUM("pending", "approved", "rejected", "cancelled"),
      allowNull: false,
      defaultValue: "pending",
    });

    await queryInterface.addColumn("SalaryAdvances", "cancelled_at", {
      type: DataTypes.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn("SalaryAdvances", "cancelled_by", {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Users", key: "id" },
    });
    await queryInterface.addColumn("SalaryAdvances", "cancellation_reason", {
      type: DataTypes.TEXT,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("SalaryAdvances", "cancellation_reason");
    await queryInterface.removeColumn("SalaryAdvances", "cancelled_by");
    await queryInterface.removeColumn("SalaryAdvances", "cancelled_at");

    // Falla si ya hay adelantos con status='cancelled' — esperado, hay que resolverlos antes
    // de hacer downgrade.
    await queryInterface.changeColumn("SalaryAdvances", "status", {
      type: DataTypes.ENUM("pending", "approved", "rejected"),
      allowNull: false,
      defaultValue: "pending",
    });
  },
};
