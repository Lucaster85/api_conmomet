"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE PayrollLines
      MODIFY COLUMN line_type ENUM('regular','extras_50','extras_100','holiday','fixed','retroactive','vacation','medical_leave','justified','medical_leave_deduction','vacation_deduction','absence_deduction')
      NOT NULL DEFAULT 'regular'
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE PayrollLines
      MODIFY COLUMN line_type ENUM('regular','extras_50','extras_100','holiday','fixed','retroactive','vacation','medical_leave','justified')
      NOT NULL DEFAULT 'regular'
    `);
  },
};
