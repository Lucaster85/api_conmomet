"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class EditSession extends Model {
    static associate(models) {
      EditSession.belongsTo(models.User, { foreignKey: "user_id", as: "user" });
    }
  }
  EditSession.init({
    entity_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    entity_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Users", key: "id" },
    },
    last_seen_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: "EditSession",
    tableName: "EditSessions",
    timestamps: true,
    underscored: true,
    // Sin paranoid: es presencia efímera (heartbeat), no un registro de auditoría — mismo
    // criterio que AuditLog.
  });
  return EditSession;
};
