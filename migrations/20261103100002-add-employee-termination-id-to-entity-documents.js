"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Nullable: los documentos que no son del egreso (DNI, carnet, etc.) no lo usan. Un papel del
    // egreso sigue siendo un EntityDocument del empleado (entity_type = "employee"), así que
    // aparece también en la pestaña "Documentos y Vencimientos" del legajo.
    await queryInterface.addColumn("EntityDocuments", "employee_termination_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: "EmployeeTerminations", key: "id" },
    });
    await queryInterface.addIndex("EntityDocuments", ["employee_termination_id"], {
      name: "entity_documents_employee_termination_id",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex("EntityDocuments", "entity_documents_employee_termination_id");
    await queryInterface.removeColumn("EntityDocuments", "employee_termination_id");
  },
};
