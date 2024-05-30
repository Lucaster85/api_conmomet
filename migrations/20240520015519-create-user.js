"use strict";

const { DataTypes } = require("sequelize");

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable(
      "Users",
      {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        name: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        lastname: {
          type: Sequelize.STRING(50),
          allowNull: false,
        },
        password: {
          type: Sequelize.STRING(255),
          allowNull: false,
        },
        email: {
          type: Sequelize.STRING(255),
          allowNull: false,
          unique: true,
        },
        cuit: { 
          type: Sequelize.INTEGER, 
          allowNull: false, 
          unique: true },
        phone: {
          type: Sequelize.STRING,
          validate: {
            is: /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]*$/i,  // Validación de formato de número telefónico
          }
        },
        celphone: {
          type: Sequelize.STRING
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        deleted_at: {
          type: Sequelize.DATE,
        },
      },
      {}
    );
    await queryInterface.createTable(
      "user_permission",
      {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        user_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: "Users",
            key: "id"
          },
        },
        permission_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: "Permissions",
            key: "id",
          },
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        deleted_at: {
          type: Sequelize.DATE
        },
      }
    );
    await queryInterface.createTable(
      "role_permission",
      {
        id: {
          allowNull: false,
          autoIncrement: true,
          primaryKey: true,
          type: Sequelize.INTEGER,
        },
        role_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: "Roles",
            key: "id"
          },
        },
        permission_id: {
          type: DataTypes.INTEGER,
          allowNull: false,
          references: {
            model: "Permissions",
            key: "id",
          },
        },
        created_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        updated_at: {
          allowNull: false,
          type: Sequelize.DATE,
          defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
        },
        deleted_at: {
          type: Sequelize.DATE
        },
      }
    );
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("Users");
    await queryInterface.dropTable("user_permissions");
    await queryInterface.dropTable("role_permissions");
  },
};
