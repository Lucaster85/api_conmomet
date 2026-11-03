"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("EmployeeTerminations", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      employee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Employees", key: "id" },
      },
      type: {
        type: Sequelize.ENUM("resignation", "dismissal_with_cause", "dismissal_without_cause", "mutual_agreement"),
        allowNull: false,
      },
      // Fecha de la comunicación (telegrama recibido / enviado).
      notice_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      // Último día de la relación laboral. Al confirmar se copia a Employees.termination_date.
      termination_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      // Solo despido sin causa: si la empresa preavisó.
      notice_given: {
        type: Sequelize.ENUM("none", "full", "partial"),
        allowNull: false,
        defaultValue: "none",
      },
      notice_start_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      notice_end_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      cause_description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      // Renuncia sin los 15 días de preaviso del trabajador.
      employee_notice_omitted: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Tope del art. 245 (3 × promedio del CCT), dato que carga el usuario.
      cct_cap_amount: {
        type: Sequelize.DECIMAL(14, 2),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM("draft", "confirmed", "settled", "cancelled"),
        allowNull: false,
        defaultValue: "draft",
      },
      // Se completa en la Etapa 3 (liquidación final).
      final_payroll_entry_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "PayrollEntries", key: "id" },
      },
      art80_delivered_at: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      confirmed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      confirmed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cancelled_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      cancellation_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    await queryInterface.addIndex("EmployeeTerminations", ["employee_id", "status"], {
      name: "employee_terminations_employee_status",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("EmployeeTerminations");
  },
};
