"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Create EntityDocuments table
    await queryInterface.createTable("EntityDocuments", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      title: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      notes: {
        type: Sequelize.TEXT,
      },
      entity_type: {
        type: Sequelize.ENUM("employee", "vehicle", "project", "company"),
        allowNull: false,
      },
      entity_id: {
        type: Sequelize.INTEGER,
      },
      file_url: {
        type: Sequelize.STRING(500),
      },
      file_key: {
        type: Sequelize.STRING(500),
      },
      file_name: {
        type: Sequelize.STRING(255),
      },
      expiration_date: {
        type: Sequelize.DATEONLY,
      },
      notify_days_before: {
        type: Sequelize.INTEGER,
        defaultValue: 15,
      },
      alert_status: {
        type: Sequelize.ENUM("pending", "warned", "expired_warned", "resolved"),
        defaultValue: "pending",
      },
      resolved_at: {
        type: Sequelize.DATE,
      },
      resolved_by: {
        type: Sequelize.INTEGER,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      uploaded_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
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
    });

    // 2. Check if EmployeeDocuments exists and migrate data
    const tableExists = await queryInterface.sequelize.query(
      "SHOW TABLES LIKE 'EmployeeDocuments';",
      { type: Sequelize.QueryTypes.SELECT }
    );

    if (tableExists.length > 0) {
      const oldDocs = await queryInterface.sequelize.query(
        "SELECT * FROM EmployeeDocuments WHERE deleted_at IS NULL;",
        { type: Sequelize.QueryTypes.SELECT }
      );

      if (oldDocs.length > 0) {
        const recordsToInsert = oldDocs.map((doc) => ({
          title: doc.title,
          notes: null,
          entity_type: "employee",
          entity_id: doc.employee_id,
          file_url: doc.file_url,
          file_key: doc.file_key,
          file_name: doc.file_name,
          expiration_date: null,
          notify_days_before: 15,
          alert_status: "pending",
          uploaded_by: doc.uploaded_by,
          created_at: doc.created_at || new Date(),
          updated_at: doc.updated_at || new Date(),
        }));

        await queryInterface.bulkInsert("EntityDocuments", recordsToInsert);
      }

      // 3. Drop old table
      await queryInterface.dropTable("EmployeeDocuments");
    }
  },

  async down(queryInterface, Sequelize) {
    // Note: Rolling back this migration completely restores the schema, 
    // but the data migrated from EmployeeDocuments will be lost 
    // if we just recreate the empty EmployeeDocuments table.
    // In a real prod environment we'd extract it back.

    await queryInterface.createTable("EmployeeDocuments", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      employee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Employees", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      title: {
        type: Sequelize.STRING(150),
        allowNull: false,
      },
      file_url: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      file_key: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      file_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      file_type: {
        type: Sequelize.STRING(50),
      },
      uploaded_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      deleted_at: {
        type: Sequelize.DATE,
      },
    });

    await queryInterface.dropTable("EntityDocuments");
  },
};
