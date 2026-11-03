"use strict";

/**
 * Acuerdo de pago de la indemnización de un egreso (PLAN_EGRESOS.md §7): despido sin causa, mutuo
 * acuerdo, o un reclamo posterior a un despido con causa. Un solo acuerdo activo por egreso
 * (validado en el controller, MySQL no tiene índices únicos parciales). Las cuotas son de monto fijo,
 * sin actualización ni intereses.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("TerminationAgreements", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      termination_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "EmployeeTerminations", key: "id" },
      },
      // Monto pactado: precargado con el legal calculado, editable.
      total_amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      agreement_date: { type: Sequelize.DATEONLY, allowNull: false },
      // Homologado ante SECLO / ministerio.
      homologated: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      notes: { type: Sequelize.TEXT, allowNull: true },
      status: { type: Sequelize.ENUM("active", "cancelled"), allowNull: false, defaultValue: "active" },
      cancelled_at: { type: Sequelize.DATE, allowNull: true },
      cancelled_by: { type: Sequelize.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      cancellation_reason: { type: Sequelize.TEXT, allowNull: true },
      created_by: { type: Sequelize.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      created_at: { allowNull: false, type: Sequelize.DATE },
      updated_at: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("TerminationAgreements", ["termination_id", "status"], {
      name: "termination_agreements_termination_status",
    });

    await queryInterface.createTable("TerminationAgreementInstallments", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      agreement_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "TerminationAgreements", key: "id" },
      },
      installment_number: { type: Sequelize.INTEGER, allowNull: false },
      due_date: { type: Sequelize.DATEONLY, allowNull: false },
      amount: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      // Fecha del pago: define en qué mes entra la cuota al Resumen de costos.
      paid_at: { type: Sequelize.DATEONLY, allowNull: true },
      payment_method: { type: Sequelize.ENUM("efectivo", "transferencia"), allowNull: true },
      paid_by: { type: Sequelize.INTEGER, allowNull: true, references: { model: "Users", key: "id" } },
      payment_proof_url: { type: Sequelize.STRING(500), allowNull: true },
      payment_proof_key: { type: Sequelize.STRING(500), allowNull: true },
      payment_proof_name: { type: Sequelize.STRING(255), allowNull: true },
      signature_url: { type: Sequelize.STRING(500), allowNull: true },
      signature_key: { type: Sequelize.STRING(500), allowNull: true },
      signature_name: { type: Sequelize.STRING(255), allowNull: true },
      created_at: { allowNull: false, type: Sequelize.DATE },
      updated_at: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("TerminationAgreementInstallments", ["agreement_id", "installment_number"], {
      name: "termination_agreement_installments_agreement_number",
    });
    await queryInterface.addIndex("TerminationAgreementInstallments", ["paid_at"], {
      name: "termination_agreement_installments_paid_at",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("TerminationAgreementInstallments");
    await queryInterface.dropTable("TerminationAgreements");
  },
};
