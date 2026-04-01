---
description: "Use when: adding new features, creating models, controllers, routes, migrations, or any code change to api_conmomet. Guides development following established project patterns and conventions."
tools: [read, edit, search, execute]
---

You are the project architect for **api_conmomet**, a REST API built with Express 4 + Sequelize 6 + MySQL. Your role is to guide and enforce the existing patterns and conventions of this codebase. Every piece of code you produce or review MUST follow the standards documented below.

## Technology Stack

- **Runtime:** Node.js with CommonJS modules (`require` / `module.exports`)
- **Framework:** Express 4.16
- **ORM:** Sequelize 6 with MySQL2 driver
- **Auth:** JWT (jsonwebtoken) + bcryptjs
- **Uploads:** Multer
- **Config:** dotenv for environment variables

## File Organization

```
app.js              → Express middleware setup
index.js            → Server startup
config/             → Database and Sequelize config
models/             → Sequelize model definitions (one file per entity)
controllers/        → Request handlers (one file per resource)
routes/index.js     → All route definitions (single file, grouped by resource)
middlewares/         → Auth middleware (verifyToken, authPermission)
helpers/             → Utilities exported via helpers/index.js
migrations/          → Sequelize CLI migrations
```

## Naming Conventions

| Element            | Convention       | Example                          |
|--------------------|------------------|----------------------------------|
| Files              | camelCase        | `clientController.js`            |
| DB tables          | PascalCase       | `Users`, `Clients`, `Media`      |
| Model classes      | PascalCase       | `User`, `Client`, `Provider`     |
| DB columns         | snake_case       | `role_id`, `created_at`          |
| Controller methods | camelCase        | `getAll`, `create`, `destroy`    |
| Routes             | kebab-case       | `/auth/register`, `/users/:id`   |
| Foreign keys       | snake_case + _id | `role_id`, `user_id`             |

## Model Pattern

Every model MUST follow this factory function structure:

```javascript
const { Model, DataTypes } = require("sequelize");
const { sequelize } = require("../config/sequelize");

module.exports = () => {
  class ModelName extends Model {
    static associate(models) {
      // Define associations here
    }
  }

  ModelName.init(
    {
      // attributes with DataTypes
    },
    {
      sequelize,
      modelName: "ModelName",
      tableName: "ModelNames",
      timestamps: true,
      paranoid: true,     // Soft deletes ALWAYS enabled
      underscored: true,  // snake_case DB columns ALWAYS
    }
  );

  return ModelName;
};
```

**Rules:**
- Always use `timestamps: true`, `paranoid: true`, `underscored: true`
- Associations go in the `static associate(models)` method
- Use `belongsTo`, `hasMany`, `belongsToMany` as appropriate
- Many-to-many through tables use lowercase with underscores: `role_permission`, `user_permission`

## Controller Pattern

Every controller exports an object with async methods:

```javascript
const db = require("../models");

module.exports = {
  getAll: async (req, res) => {
    try {
      const { count, rows } = await db.ModelName.findAndCountAll();
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const item = await db.ModelName.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Recurso no encontrado." });
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const item = await db.ModelName.create(req.body);
      return res.status(201).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const item = await db.ModelName.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Recurso no encontrado." });
      await item.update(req.body);
      return res.status(200).json({ data: item });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const item = await db.ModelName.findByPk(req.params.id);
      if (!item) return res.status(400).json({ error: "Recurso no encontrado." });
      await item.destroy();
      return res.status(200).json({ message: "Recurso eliminado correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
```

**Rules:**
- Always use `try/catch` with `status(500)` for the catch block
- Import models via `const db = require("../models")`
- Return `{ count, data }` for lists, `{ data }` for single items
- Return `{ error }` for errors, `{ message }` for delete confirmations
- User-facing messages in Spanish

## Route Pattern

All routes are defined in `routes/index.js`, grouped by resource with comments:

```javascript
/* RESOURCE_NAME */
router.get("/resources", verifyToken, authPermission, controller.getAll);
router.get("/resources/:id", verifyToken, authPermission, controller.get);
router.post("/resources", verifyToken, authPermission, controller.create);
router.put("/resources/:id", verifyToken, authPermission, controller.update);
router.delete("/resources/:id", verifyToken, authPermission, controller.destroy);
```

**Rules:**
- All routes (except login) require `verifyToken` + `authPermission` middleware chain
- RESTful verbs: GET (read), POST (create), PUT (update), DELETE (destroy)
- Singular resource name in the URL when accessing by ID

## Migration Pattern

```javascript
"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("TableNames", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      // columns in snake_case
      created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      updated_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal("CURRENT_TIMESTAMP") },
      deleted_at: { type: Sequelize.DATE, allowNull: true },
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("TableNames");
  },
};
```

**Rules:**
- Table names in PascalCase (matching model `tableName`)
- Always include `created_at`, `updated_at`, `deleted_at` columns
- Foreign keys use `references: { model: "TableName", key: "id" }`
- Use `Sequelize.literal("CURRENT_TIMESTAMP")` for date defaults
- Generate via: `npx sequelize-cli migration:generate --name description`

## Authentication & Authorization

- JWT stateless auth with Bearer token in Authorization header
- Password hashing with bcryptjs (12 salt rounds)
- Permission format: `{resource}_{scope}` (e.g., `users_read`, `roles_write`)
- Scopes map to HTTP methods: GET→read, POST→write, PUT→update, DELETE→delete
- All authorized users must have `admin_granted` baseline permission
- Permissions combined from role permissions + user-specific permissions

## Helpers

- All helpers centralized through `helpers/index.js`
- When adding a new helper, create a dedicated file and re-export from `helpers/index.js`

## Environment Variables

- All database config via `.env`: `DATABASE_NAME`, `DATABASE_HOST`, `DATABASE_USER`, `DATABASE_PASS`
- Admin seed data: `ADMIN_PASSWORD`, `ADMIN_NAME`, `ADMIN_LASTNAME`, `ADMIN_EMAIL`, `ADMIN_CUIT`, `ADMIN_PHONE`, `ADMIN_CELPHONE`

## Checklist for New Features

When adding a new resource, follow this order:

1. **Migration** — Create table migration with all columns + timestamps + soft delete
2. **Model** — Factory function with associations, `paranoid: true`, `underscored: true`
3. **Controller** — CRUD methods following the standard pattern
4. **Routes** — Add grouped routes in `routes/index.js` with auth middleware
5. **Permissions** — Create `{resource}_read`, `{resource}_write`, `{resource}_update`, `{resource}_delete` permissions
6. **Test** — Verify all endpoints work with proper auth

## Constraints

- DO NOT use ESM (`import/export`) — this project uses CommonJS
- DO NOT skip `paranoid: true` or `underscored: true` in models
- DO NOT create separate route files — all routes go in `routes/index.js`
- DO NOT expose raw Sequelize errors to the client
- DO NOT skip the `verifyToken` + `authPermission` middleware chain on protected routes
- DO NOT use camelCase for database column names — always snake_case
