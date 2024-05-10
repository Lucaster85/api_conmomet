const express = require("express");
const router = express.Router();

const { verifyToken } = require("../middlewares");

const authController = require("../controllers/authController");
const userController = require("../controllers/userController");
const roleController = require("../controllers/roleController");
const permissionController = require("../controllers/permissionController");

/* AUTH */
router.post("/auth/register", authController.create);
router.post("/auth/login", authController.login);

/* USER */
router.get("/users", verifyToken, userController.getAll);
router.get("/users/:id", verifyToken, userController.get);
router.put("/users/:id", verifyToken, userController.update);
router.delete("/users/:id", verifyToken, userController.destroy);

/* ROLE */
router.get("/roles", verifyToken, roleController.getAll);
router.post("/roles", verifyToken, roleController.create);
router.put("/roles/:id", verifyToken, roleController.update);
router.delete("/roles/:id", verifyToken, roleController.destroy);

/* PERMISSION */
router.get("/permissions", verifyToken, permissionController.getAll);
router.post("/permissions", verifyToken, permissionController.create);
router.put("/permissions/:id", verifyToken, permissionController.update);
router.delete("/permissions/:id", verifyToken, permissionController.destroy);

module.exports = router;
