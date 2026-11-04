"use strict";
const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("QuickNotes", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: DataTypes.INTEGER },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      content: { type: DataTypes.TEXT, allowNull: false },
      // Solo fecha, sin hora: el barrido de vencimientos corre a lo sumo una vez por hora, así que
      // una hora exacta no se podría cumplir (ver FLOWS.md flujo de Notas rápidas).
      due_date: { type: DataTypes.DATEONLY, allowNull: true },
      // null = pendiente. Una fecha en vez de un booleano para poder mostrar "completada el…".
      completed_at: { type: DataTypes.DATE, allowNull: true },
      // Vínculo a futuro con una entidad del sistema (presupuesto, OCA, empleado...). Siempre null
      // por ahora: la lista blanca helpers/quickNoteEntityTypes.js está vacía. Sin FK porque es
      // polimórfico — mismo criterio que Notifications.entity_id.
      entity_type: { type: DataTypes.STRING(40), allowNull: true },
      entity_id: { type: DataTypes.INTEGER, allowNull: true },
      created_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
    });
    await queryInterface.addIndex("QuickNotes", ["user_id", "completed_at", "due_date"], {
      name: "quick_notes_user_list_idx",
    });
    // Para la futura consulta "mis notas de este presupuesto".
    await queryInterface.addIndex("QuickNotes", ["entity_type", "entity_id"], {
      name: "quick_notes_entity_idx",
    });
  },
  async down(queryInterface) {
    await queryInterface.dropTable("QuickNotes");
  },
};
