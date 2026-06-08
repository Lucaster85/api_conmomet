'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Feriados nacionales de Argentina 2026
    const allHolidays = [
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
    ];

    // Obtener los feriados que ya existen en la base de datos
    const [existingHolidays] = await queryInterface.sequelize.query('SELECT date FROM Holidays');
    const existingDates = new Set(existingHolidays.map(h => {
      if (!h.date) return null;
      if (h.date instanceof Date) {
        return h.date.toISOString().split('T')[0];
      }
      if (typeof h.date === 'string') {
        return h.date.split(' ')[0];
      }
      return h.date;
    }).filter(Boolean));

    // Filtrar los que ya existen
    const holidaysToInsert = allHolidays.filter(h => !existingDates.has(h.date));

    if (holidaysToInsert.length > 0) {
      await queryInterface.bulkInsert('Holidays', holidaysToInsert, {});
    }
  },

  down: async (queryInterface, Sequelize) => {
    const { Op } = require("sequelize");
    await queryInterface.bulkDelete('Holidays', {
      date: { [Op.between]: ['2026-01-01', '2026-12-31'] }
    }, {});
  }
};
