"use strict";

/**
 * `Employees.user_id` es una FK nullable a Users sin constraint UNIQUE desde su creación
 * original. Con la invitación al portal (empleados creando su propio User), conviene blindar
 * a nivel de base de datos que dos Employees no terminen apuntando al mismo User.
 *
 * IMPORTANTE — correr ANTES de aplicar esta migración, contra la base real:
 *   SELECT user_id, COUNT(*) FROM Employees WHERE user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1;
 * Si devuelve filas, esta migración va a fallar al crear la constraint. Resolver el duplicado
 * manualmente (decidir qué Employee se queda con el user_id) antes de migrar.
 */

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.addConstraint("Employees", {
      fields: ["user_id"],
      type: "unique",
      name: "employees_user_id_unique",
    });
  },
  async down(queryInterface) {
    await queryInterface.removeConstraint("Employees", "employees_user_id_unique");
  },
};
