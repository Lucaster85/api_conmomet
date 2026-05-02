"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Add FK constraint from TimeEntries.project_id → Projects.id
    await queryInterface.addConstraint("TimeEntries", {
      fields: ["project_id"],
      type: "foreign key",
      name: "fk_time_entries_project",
      references: {
        table: "Projects",
        field: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeConstraint("TimeEntries", "fk_time_entries_project");
  },
};
