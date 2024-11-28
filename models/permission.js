"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Permission extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Permission.belongsToMany(models.User, { through: "user_permission", foreignKey: "permission_id"});
      Permission.belongsToMany(models.Role, { through: "role_permission", foreignKey: "permission_id"});
    }
  }
  Permission.init(
    {
      name: { type: DataTypes.STRING, unique: true },
    },
    {
      sequelize,
      modelName: "Permission",
      tableName: "Permissions",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return Permission;
};
