"use strict";
// Períodos que NO son una quincena: el aguinaldo abarca el semestre y la liquidación final todo el
// mes del egreso. Ninguno de los dos entra en los flujos que buscan "la quincena de una fecha"
// (carga de horas, adelantos, retroactivos), en la base de las remuneraciones ni en `generate`.
const NON_QUINCENA_TYPES = ["sac", "final"];

module.exports = { NON_QUINCENA_TYPES };
