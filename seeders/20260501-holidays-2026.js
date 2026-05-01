'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Feriados nacionales de Argentina 2026
    await queryInterface.bulkInsert('Holidays', [
      { date: '2026-01-01', name: 'Año Nuevo', created_at: new Date(), updated_at: new Date() },
      { date: '2026-02-16', name: 'Carnaval', created_at: new Date(), updated_at: new Date() },
      { date: '2026-02-17', name: 'Carnaval', created_at: new Date(), updated_at: new Date() },
      { date: '2026-03-24', name: 'Día Nacional de la Memoria', created_at: new Date(), updated_at: new Date() },
      { date: '2026-04-02', name: 'Día del Veterano y de los Caídos en Malvinas', created_at: new Date(), updated_at: new Date() },
      { date: '2026-04-03', name: 'Viernes Santo', created_at: new Date(), updated_at: new Date() },
      { date: '2026-05-01', name: 'Día del Trabajador', created_at: new Date(), updated_at: new Date() },
      { date: '2026-05-25', name: 'Día de la Revolución de Mayo', created_at: new Date(), updated_at: new Date() },
      { date: '2026-06-15', name: 'Paso a la Inmortalidad del Gral. Güemes', created_at: new Date(), updated_at: new Date() },
      { date: '2026-06-20', name: 'Paso a la Inmortalidad del Gral. Belgrano', created_at: new Date(), updated_at: new Date() },
      { date: '2026-07-09', name: 'Día de la Independencia', created_at: new Date(), updated_at: new Date() },
      { date: '2026-08-17', name: 'Paso a la Inmortalidad del Gral. San Martín', created_at: new Date(), updated_at: new Date() },
      { date: '2026-10-12', name: 'Día del Respeto a la Diversidad Cultural', created_at: new Date(), updated_at: new Date() },
      { date: '2026-11-23', name: 'Día de la Soberanía Nacional', created_at: new Date(), updated_at: new Date() },
      { date: '2026-12-08', name: 'Inmaculada Concepción de María', created_at: new Date(), updated_at: new Date() },
      { date: '2026-12-25', name: 'Navidad', created_at: new Date(), updated_at: new Date() },
    ], {});
  },

  down: async (queryInterface, Sequelize) => {
    const { Op } = require("sequelize");
    await queryInterface.bulkDelete('Holidays', {
      date: { [Op.between]: ['2026-01-01', '2026-12-31'] }
    }, {});
  }
};
