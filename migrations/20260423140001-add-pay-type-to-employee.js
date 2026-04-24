"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add pay_type and monthly_salary to Employees
    await queryInterface.addColumn("Employees", "pay_type", {
      type: Sequelize.ENUM("hourly", "monthly"),
      defaultValue: "hourly",
      allowNull: false,
    });

    await queryInterface.addColumn("Employees", "monthly_salary", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: null,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("Employees", "monthly_salary");
    await queryInterface.removeColumn("Employees", "pay_type");
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_Employees_pay_type";');
  },
};
