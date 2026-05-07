'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('Categories', 'guild_id', {
      type: Sequelize.INTEGER,
      allowNull: true, // Initially true so we can migrate existing data without errors
      references: {
        model: 'Guilds',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('Categories', 'guild_id');
  }
};
