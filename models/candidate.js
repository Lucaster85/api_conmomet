"use strict";
const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/sequelize");

// La PERSONA que se presenta a trabajar (ver FLOWS.md §59). Se separa de la postulación a
// propósito, como hacen los sistemas de reclutamiento: los datos de la persona se cargan una sola
// vez, y cada vez que se presenta es una CandidateApplication nueva. La contratación convierte al
// candidato en empleado reusando estos datos (etapa 5).
//
// Soft delete en el modelo (por si algo lo borra sin querer), pero el controller elimina con
// `force: true`: es un dato personal (Ley 25.326) y a pedido de la persona tiene que desaparecer de
// verdad. Además así `dni`/`cuil` únicos quedan libres si la misma persona vuelve a presentarse.
//
// `dni` y `cuil` son opcionales y únicos: MySQL permite varios NULL en un índice único, y por eso
// el controller guarda null (no "") cuando vienen vacíos.
module.exports = () => {
  class Candidate extends Model {
    static associate(models) {
      Candidate.hasMany(models.CandidateApplication, { foreignKey: "candidate_id", as: "applications" });
      Candidate.hasMany(models.CandidateFile, { foreignKey: "candidate_id", as: "files" });
      Candidate.belongsTo(models.Category, { foreignKey: "category_id", as: "category" });
      Candidate.belongsTo(models.Employee, { foreignKey: "employee_id", as: "employee" });
      Candidate.belongsTo(models.Employee, { foreignKey: "referred_by_employee_id", as: "referredBy" });
      Candidate.belongsTo(models.User, { foreignKey: "created_by", as: "createdByUser" });
      Candidate.belongsTo(models.User, { foreignKey: "converted_by", as: "convertedByUser" });
    }
  }
  Candidate.init(
    {
      name: { type: DataTypes.STRING(50), allowNull: false },
      lastname: { type: DataTypes.STRING(50), allowNull: false },
      dni: { type: DataTypes.STRING(10), allowNull: true, unique: true },
      cuil: { type: DataTypes.STRING(13), allowNull: true, unique: true },
      email: { type: DataTypes.STRING(255), allowNull: true },
      phone: { type: DataTypes.STRING(30), allowNull: true },
      birth_date: { type: DataTypes.DATEONLY, allowNull: true },
      address: { type: DataTypes.STRING(255), allowNull: true },
      locality: { type: DataTypes.STRING(100), allowNull: true },
      trade: { type: DataTypes.STRING(100), allowNull: true, comment: "Oficio o puesto de interés" },
      category_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Categories", key: "id" },
      },
      years_experience: { type: DataTypes.INTEGER, allowNull: true },
      has_driver_license: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      notes: { type: DataTypes.TEXT, allowNull: true },
      source: {
        type: DataTypes.ENUM("web", "in_person", "referral", "other"),
        allowNull: false,
        defaultValue: "in_person",
      },
      referred_by_employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Employees", key: "id" },
      },
      // Consentimiento de tratamiento de datos (Ley 25.326). Lo completa la etapa 3 (web); en la
      // carga interna no hay consentimiento del propio candidato, así que quedan en null.
      consent_accepted_at: { type: DataTypes.DATE, allowNull: true },
      consent_version: { type: DataTypes.STRING(20), allowNull: true },
      consent_ip: { type: DataTypes.STRING(64), allowNull: true },
      // Conversión en empleado (etapa 5). employee_id único: un empleado sale de un solo candidato.
      employee_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        unique: true,
        references: { model: "Employees", key: "id" },
      },
      converted_at: { type: DataTypes.DATE, allowNull: true },
      converted_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "Users", key: "id" },
        comment: "null = lo cargó el propio candidato desde la web",
      },
    },
    {
      sequelize,
      modelName: "Candidate",
      tableName: "Candidates",
      timestamps: true,
      paranoid: true,
      underscored: true,
    }
  );
  return Candidate;
};
