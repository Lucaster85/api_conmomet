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
      User.belongsTo(models.Role, { as: "role", foreignKey: "role_id" });
      User.belongsToMany(models.Permission, {
        through: "user_permission",
        as: "permissions",
        foreignKey: "user_id"
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
      cuit: { type: DataTypes.STRING(11), unique: true, allowNull: false },
      phone: {
        type: DataTypes.STRING,
      },
      celphone: {
        type: DataTypes.STRING
      },
      must_change_password: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "User",
      tableName: "Users",
      timestamps: true,
      paranoid: true,
      underscored: true,
      // El hash de la contraseña NUNCA sale en una consulta por defecto (ni en los include de
      // otros modelos: Sequelize aplica el defaultScope también ahí). Quien necesite el hash
      // (login y cambio de contraseña) usa db.User.scope("withPassword"). FLOWS.md §75.1.
      defaultScope: { attributes: { exclude: ["password"] } },
      scopes: { withPassword: {} },
    }
  );

  // El scope no alcanza a las instancias que devuelven create() y save() (tienen el hash en
  // memoria): toJSON lo saca para que ningún res.json(user) lo filtre.
  User.prototype.toJSON = function toJSON() {
    const values = { ...this.get({ plain: true }) };
    delete values.password;
    return values;
  };

  return User;
};
