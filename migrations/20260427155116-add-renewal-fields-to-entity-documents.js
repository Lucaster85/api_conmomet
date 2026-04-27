'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('EntityDocuments', 'is_renewable', {
      type: Sequelize.BOOLEAN,
      defaultValue: true,
      allowNull: false
    });

    await queryInterface.addColumn('EntityDocuments', 'previous_record_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'EntityDocuments',
        key: 'id'
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('EntityDocuments', 'previous_record_id');
    await queryInterface.removeColumn('EntityDocuments', 'is_renewable');
  }
};
