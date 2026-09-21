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
         { through: "role_permission", as: "permissions", foreignKey: "role_id" });
      Role.hasMany(models.User);
    }
  }

  Role.init(
    {
      name: DataTypes.STRING,
      has_dashboard_access: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      },
      // Identificador interno inmutable: el seed y el código lo usan para encontrar roles del
      // sistema (superadmin, admin, operario), nunca `name` — que el usuario puede renombrar
      // libremente desde /dashboard/roles.
      key: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      // Jerarquía numérica (1-100, mayor = más privilegio). Un usuario solo puede asignar o
      // gestionar roles con `level` estrictamente menor al de su propio rol.
      level: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 10,
        validate: { min: 1, max: 100 },
      },
      // Roles técnicos (superadmin, admin, operario): protegidos contra edición/borrado desde
      // el dashboard, sin importar el level del actor.
      is_system: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "Role",
      tableName: "Roles",
      timestamps: true,
      paranoid: true,
      underscored: true
    }
  );
  return Role;
};
