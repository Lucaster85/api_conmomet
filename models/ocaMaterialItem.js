"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

module.exports = () => {
  class OcaMaterialItem extends Model {
    static associate(models) {
      OcaMaterialItem.belongsTo(models.Oca, { foreignKey: "oca_id", as: "oca" });
      OcaMaterialItem.belongsTo(models.Material, { foreignKey: "material_id", as: "material" });
      OcaMaterialItem.belongsTo(models.MaterialUnit, { foreignKey: "material_unit_id", as: "materialUnit" });
    }
  }
  OcaMaterialItem.init({
    oca_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "Ocas", key: "id" },
    },
    material_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: { model: "Materials", key: "id" },
      comment: "Vínculo opcional al catálogo de materiales — una línea puede seguir siendo solo texto libre",
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    quantity: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    material_unit_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: "MaterialUnits", key: "id" },
    },
    notes: {
      type: DataTypes.TEXT,
    },
  }, {
    sequelize,
    modelName: "OcaMaterialItem",
    tableName: "OcaMaterialItems",
    timestamps: true,
    paranoid: true,
    underscored: true,
    // Sin precio a propósito: es un registro tipo remito (material + cantidad) para OCAs de
    // horas hombre, se imprime como sección aparte al final de "Imprimir Remito" — no es el
    // BudgetMaterialItem con costo/margen de los Presupuestos.
  });
  return OcaMaterialItem;
};
