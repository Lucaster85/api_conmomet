'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Idempotente a propósito: si una corrida anterior falló después de agregar las columnas
    // pero antes de terminar (ej. un error de sintaxis en el UPDATE), reintentar no debe romper
    // en "columna ya existe". MySQL además no permite rollback de DDL dentro de una transacción,
    // así que esto es lo que sí podemos controlar acá.
    const table = await queryInterface.describeTable('Roles');

    if (!table.key) {
      await queryInterface.addColumn('Roles', 'key', { type: Sequelize.STRING, unique: true });
    }
    if (!table.level) {
      await queryInterface.addColumn('Roles', 'level', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 10,
      });
    }
    if (!table.is_system) {
      await queryInterface.addColumn('Roles', 'is_system', {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      });
    }

    // El backfill de datos sí es DML: lo hacemos atómico con una transacción.
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Mapeo fijo por id: el id no cambia aunque el `name` haya sido renombrado desde
      // /dashboard/roles, así que es seguro usarlo acá (a diferencia del seed y del resto del
      // código, que de ahora en más deben buscar por `key` — ver helpers/seed.js).
      // Nota: `key` es palabra reservada en MySQL, hay que escaparla con backticks.
      const fixedMapping = [
        { id: 1, key: 'superadmin', level: 100, is_system: true },
        { id: 3, key: 'manager', level: 30, is_system: false },
        { id: 4, key: 'provider', level: 10, is_system: false },
        { id: 5, key: 'customer', level: 10, is_system: false },
        { id: 6, key: 'user', level: 10, is_system: false },
      ];
      for (const role of fixedMapping) {
        await queryInterface.sequelize.query(
          'UPDATE Roles SET `key` = :key, level = :level, is_system = :is_system WHERE id = :id',
          { replacements: role, transaction }
        );
      }

      // El rol "admin" (id 2 en la migración original de creación de Roles) es el que
      // seedAdminRole gestiona: recibe el permiso admin_granted y es el rol del usuario
      // ADMIN_EMAIL. Si se renombró desde el dashboard (ej. a "socio-gerente") y después corrió
      // el seed de nuevo, el seed no lo encontró por `name: 'admin'` y creó un rol duplicado con
      // ese nombre, reasignando de paso el usuario ADMIN_EMAIL a ese duplicado. Detectamos ese
      // caso acá en vez de asumir nada:
      const [duplicates] = await queryInterface.sequelize.query(
        "SELECT id FROM Roles WHERE name = 'admin' AND id <> 2 AND deleted_at IS NULL ORDER BY id",
        { transaction }
      );

      if (duplicates.length > 0) {
        const dupId = duplicates[0].id;
        await queryInterface.sequelize.query(
          "UPDATE Roles SET `key` = 'admin', level = 90, is_system = true WHERE id = :id",
          { replacements: { id: dupId }, transaction }
        );
        await queryInterface.sequelize.query(
          "UPDATE Roles SET `key` = 'socio_gerente', level = 80, is_system = false WHERE id = 2",
          { transaction }
        );
      } else {
        await queryInterface.sequelize.query(
          "UPDATE Roles SET `key` = 'admin', level = 90, is_system = true WHERE id = 2",
          { transaction }
        );
      }

      // Rol Operario (self-service, portal del empleado): hoy se identifica por `name` literal
      // (ver employeeInvitationController.js, que pasa a buscarlo por key en este mismo cambio).
      await queryInterface.sequelize.query(
        "UPDATE Roles SET `key` = 'operario', level = 1, is_system = true WHERE name = 'Operario'",
        { transaction }
      );

      // Cualquier rol sin key todavía (custom, creado manualmente desde el dashboard) recibe
      // una key genérica derivada de su id, para no dejar la columna NOT NULL rota.
      await queryInterface.sequelize.query(
        "UPDATE Roles SET `key` = CONCAT('role_', id) WHERE `key` IS NULL",
        { transaction }
      );
    });

    await queryInterface.changeColumn('Roles', 'key', {
      type: Sequelize.STRING,
      unique: true,
      allowNull: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('Roles', 'key');
    await queryInterface.removeColumn('Roles', 'level');
    await queryInterface.removeColumn('Roles', 'is_system');
  },
};
