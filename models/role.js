"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class Role extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      Role.belongsToMany(models.Permission,
         { through: "role_permission", as: "permissions" });
      Role.hasMany(models.User);
    }
  }

  Role.init(
    {
      name: DataTypes.STRING,
    },
    {
      sequelize,
      modelName: "Role",
      timestamps: true,
      paranoid: true,
      underscored: true
    }
  );
  return Role;
};
