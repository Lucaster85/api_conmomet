"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class User extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      User.belongsTo(models.Role, {as: "role"});
      User.belongsToMany(models.Permission, {
        through: "user_permission",
        as: "permissions"
      });
    }
  }
  User.init(
    {
      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      lastname: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
      },
      role_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "Roles",
          key: "id",
          onUpdate: "cascade",
          onDelete: "cascade",
        },
      },
      cuit: { type: DataTypes.INTEGER, unique: true, allowNull: false },
    },
    {
      sequelize,
      modelName: "User",
      timestamps: true,
      paranoid: true,
      underscored: true
    }
  );
  return User;
};
