'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 1. Holidays
    await queryInterface.createTable('Holidays', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      date: { type: Sequelize.DATEONLY, allowNull: false, unique: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // 2. PayrollConcepts
    await queryInterface.createTable('PayrollConcepts', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING(100), allowNull: false },
      code: { type: Sequelize.STRING(50), allowNull: false, unique: true },
      calc_type: { type: Sequelize.ENUM('hourly', 'fixed'), allowNull: false, defaultValue: 'hourly' },
      sort_order: { type: Sequelize.INTEGER, defaultValue: 0 },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // 3. EmployeeRates
    await queryInterface.createTable('EmployeeRates', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      employee_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'Employees', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      concept_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'PayrollConcepts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      rate: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      guild_rate: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      snr_amount: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      extras_rate: { type: Sequelize.DECIMAL(12, 2), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // 4. PayrollLines
    await queryInterface.createTable('PayrollLines', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      payroll_entry_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'PayrollEntries', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE',
      },
      concept_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'PayrollConcepts', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      label: { type: Sequelize.STRING(150), allowNull: false },
      quantity: { type: Sequelize.DECIMAL(8, 2), allowNull: false, defaultValue: 1 },
      rate: { type: Sequelize.DECIMAL(12, 2), allowNull: false },
      subtotal: { type: Sequelize.DECIMAL(14, 2), allowNull: false },
      line_type: {
        type: Sequelize.ENUM('regular', 'extras_50', 'extras_100', 'holiday', 'fixed', 'retroactive'),
        allowNull: false, defaultValue: 'regular',
      },
      source_period_id: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'PayPeriods', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // 5. RetroactiveAdjustments
    await queryInterface.createTable('RetroactiveAdjustments', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      percentage: { type: Sequelize.DECIMAL(6, 2), allowNull: false },
      from_period_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'PayPeriods', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      to_period_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'PayPeriods', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      applied_in_period_id: {
        type: Sequelize.INTEGER, allowNull: false,
        references: { model: 'PayPeriods', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT',
      },
      applies_to: {
        type: Sequelize.ENUM('all', 'hourly', 'monthly'),
        allowNull: false, defaultValue: 'all',
      },
      status: {
        type: Sequelize.ENUM('draft', 'applied'),
        allowNull: false, defaultValue: 'draft',
      },
      created_by: {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'Users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    // 6. Add concept_id to TimeEntries
    await queryInterface.addColumn('TimeEntries', 'concept_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'PayrollConcepts', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('TimeEntries', 'concept_id');
    await queryInterface.dropTable('RetroactiveAdjustments');
    await queryInterface.dropTable('PayrollLines');
    await queryInterface.dropTable('EmployeeRates');
    await queryInterface.dropTable('PayrollConcepts');
    await queryInterface.dropTable('Holidays');
  }
};
