"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("Attendances", "hours", {
      type: Sequelize.DECIMAL(4, 2),
      allowNull: true,
      comment: "Horas parciales para el día (null = día completo, 8hs). Usado en mensualizados para licencia médica / falta injustificada.",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("Attendances", "hours");
  },
};
