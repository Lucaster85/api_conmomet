const express = require("express");
const router = express.Router();

const { verifyToken, verifyRole, authPermission } = require("../middlewares");

const authController = require("../controllers/authController");
const userController = require("../controllers/userController");
const roleController = require("../controllers/roleController");
const permissionController = require("../controllers/permissionController");

/* AUTH */
router.post("/auth/register",verifyToken, authPermission, authController.create);
router.post("/auth/login", authController.login);

/* USER */
router.get("/users", verifyToken, authPermission, userController.getAll);
router.get("/users/:id", verifyToken, authPermission, userController.get);
router.put("/users/:id", verifyToken, authPermission, userController.update);
router.delete("/users/:id", verifyToken, authPermission, userController.destroy);

/* ROLE */
router.get("/roles", verifyToken, authPermission, roleController.getAll);
router.get("/roles/:id", verifyToken, authPermission, roleController.get);
router.post("/roles", verifyToken, authPermission, roleController.create);
router.put("/roles/:id", verifyToken, authPermission, roleController.update);
router.delete("/roles/:id", verifyToken, authPermission, roleController.destroy);

/* PERMISSION */
router.get("/permissions", verifyToken, authPermission, permissionController.getAll);
router.get("/permissions/:id", verifyToken, authPermission, permissionController.get);
router.post("/permissions", verifyToken, authPermission, permissionController.create);
router.put("/permissions/:id", verifyToken, authPermission, permissionController.update);
router.delete("/permissions/:id", verifyToken, authPermission, permissionController.destroy);
router.post("/permissions_assign", verifyToken, authPermission, permissionController.assign);

module.exports = router;
