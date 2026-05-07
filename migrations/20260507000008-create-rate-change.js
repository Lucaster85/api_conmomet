'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Drop old table that is being replaced
    await queryInterface.dropTable('RetroactiveAdjustments');

    await queryInterface.createTable('RateChanges', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      guild_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'Guilds',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      concept_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'PayrollConcepts',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      percentage: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false
      },
      applies_from_period: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'PayPeriods',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      applied_in_period: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'PayPeriods',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      status: {
        type: Sequelize.ENUM('pending', 'applied', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending'
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true
      },
      created_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      updated_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: {
          model: 'Users',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('RateChanges');

    // Recreate old table
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
  }
};
