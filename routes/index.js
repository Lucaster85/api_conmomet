const express = require("express");
const router = express.Router();
const multer = require("multer");

const { verifyToken, verifyRole, authPermission } = require("../middlewares");

const authController = require("../controllers/authController");
const userController = require("../controllers/userController");
const roleController = require("../controllers/roleController");
const permissionController = require("../controllers/permissionController");
const mediaController = require("../controllers/mediaController");
const clientController = require("../controllers/clientController");
const providerController = require("../controllers/providerController");

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

/* CLIENTE */

router.get("/clients", verifyToken, authPermission, clientController.getAll);
router.get("/clients/:id", verifyToken, authPermission, clientController.get);
router.post("/clients", verifyToken, authPermission, clientController.create);
router.put("/clients/:id", verifyToken, authPermission, clientController.update);
router.delete("/clients/:id", verifyToken, authPermission, clientController.destroy);

/* PROVEEDOR */

router.get("/providers", verifyToken, authPermission, providerController.getAll);
router.get("/providers/:id", verifyToken, authPermission, providerController.get);
router.post("/providers", verifyToken, authPermission, providerController.create);
router.put("/providers/:id", verifyToken, authPermission, providerController.update);
router.delete("/providers/:id", verifyToken, authPermission, providerController.destroy);

/* MEDIA */
const upload = multer({ storage: multer.memoryStorage() });

router.get("/public/media/type/:type", mediaController.getByType);

router.get("/media", verifyToken, authPermission, mediaController.getAll);
router.get("/media/type/:type", verifyToken, authPermission, mediaController.getByType);
router.get("/media/:id", verifyToken, authPermission, mediaController.get);
router.post("/media/upload", verifyToken, authPermission, upload.single('file'), mediaController.upload);
router.put("/media/reorder", verifyToken, authPermission, mediaController.reorder);
router.put("/media/:id", verifyToken, authPermission, upload.single('file'), mediaController.update);
router.delete("/media/:id", verifyToken, authPermission, mediaController.destroy);

module.exports = router;
