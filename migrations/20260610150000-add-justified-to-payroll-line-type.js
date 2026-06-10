"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE PayrollLines
      MODIFY COLUMN line_type ENUM('regular','extras_50','extras_100','holiday','fixed','retroactive','vacation','medical_leave','justified')
      NOT NULL DEFAULT 'regular'
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE PayrollLines
      MODIFY COLUMN line_type ENUM('regular','extras_50','extras_100','holiday','fixed','retroactive','vacation','medical_leave')
      NOT NULL DEFAULT 'regular'
    `);
  },
};
