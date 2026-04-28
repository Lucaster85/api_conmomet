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
const plantController = require("../controllers/plantController");
const employeeController = require("../controllers/employeeController");
const documentController = require("../controllers/documentController");
const cronController = require("../controllers/cronController");
const timeEntryController = require("../controllers/timeEntryController");
const attendanceController = require("../controllers/attendanceController");
const payPeriodController = require("../controllers/payPeriodController");
const payrollController = require("../controllers/payrollController");
const salaryAdvanceController = require("../controllers/salaryAdvanceController");
const safetyEquipmentController = require("../controllers/safetyEquipmentController");
const eppItemController = require("../controllers/eppItemController");
const contactController = require("../controllers/contactController");
const selfServiceController = require("../controllers/selfServiceController");
const leaveRequestController = require("../controllers/leaveRequestController");

/* AUTH */
router.post("/auth/login", authController.login);

/* CONTACT */
router.post("/public/contact", contactController.sendContactForm);

/* USER */
router.post("/users", verifyToken, authPermission, authController.create);
router.get("/users", verifyToken, authPermission, userController.getAll);
router.get("/users/:id", verifyToken, authPermission, userController.get);
router.put("/users/:id", verifyToken, authPermission, userController.update);
router.delete("/users/:id", verifyToken, authPermission, userController.destroy);

/* ROLE */
router.get("/roles", verifyToken, authPermission, roleController.getAll);
router.get("/roles/:id", verifyToken, authPermission, roleController.get);
router.post("/roles", verifyToken, authPermission, roleController.create);
router.put("/roles/:id/permissions", verifyToken, authPermission, roleController.setPermissions);
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

/* PLANTAS */
router.get("/plants", verifyToken, authPermission, plantController.getAll);
router.get("/plants/:id", verifyToken, authPermission, plantController.get);
router.post("/plants", verifyToken, authPermission, plantController.create);
router.put("/plants/:id", verifyToken, authPermission, plantController.update);
router.delete("/plants/:id", verifyToken, authPermission, plantController.destroy);

/* EMPLEADOS */
router.get("/employees", verifyToken, authPermission, employeeController.getAll);
router.get("/employees/:id", verifyToken, authPermission, employeeController.get);
router.post("/employees", verifyToken, authPermission, employeeController.create);
router.put("/employees/:id", verifyToken, authPermission, employeeController.update);
router.delete("/employees/:id", verifyToken, authPermission, employeeController.destroy);

/* DOCUMENTOS UNIFICADOS */
router.get("/documents", verifyToken, authPermission, documentController.getAll);
router.post("/documents", verifyToken, authPermission, upload.single('file'), documentController.create);
router.put("/documents/:id", verifyToken, authPermission, upload.single('file'), documentController.update);
router.delete("/documents/:id", verifyToken, authPermission, documentController.destroy);
router.post("/documents/:id/renew", verifyToken, authPermission, upload.single('file'), documentController.renew);
router.put("/documents/:id/resolve", verifyToken, authPermission, upload.single('file'), documentController.resolve);
router.get("/documents/:id/history", verifyToken, authPermission, documentController.getHistory);

/* CRON JOBS (Expirations) */
// This endpoint is protected by a custom secret, not a user token, so external services can call it
const verifyCronSecret = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized cron access." });
  }
  next();
};
router.post("/cron/check-expirations", verifyCronSecret, cronController.checkExpirations);

/* CARGA DE HORAS */
router.get("/time-entries", verifyToken, authPermission, timeEntryController.getAll);
router.post("/time-entries", verifyToken, authPermission, timeEntryController.create);
router.put("/time-entries/:id", verifyToken, authPermission, timeEntryController.update);
router.put("/time-entries/:id/void", verifyToken, authPermission, timeEntryController.void);
router.put("/time-entries/:id/approve", verifyToken, authPermission, timeEntryController.approve);

/* PRESENTISMO */
router.get("/attendance", verifyToken, authPermission, attendanceController.getAll);
router.post("/attendance", verifyToken, authPermission, upload.single('file'), attendanceController.create);
router.put("/attendance/:id", verifyToken, authPermission, upload.single('file'), attendanceController.update);

/* QUINCENAS */
router.get("/pay-periods", verifyToken, authPermission, payPeriodController.getAll);
router.post("/pay-periods", verifyToken, authPermission, payPeriodController.create);
router.put("/pay-periods/:id/close", verifyToken, authPermission, payPeriodController.close);
router.put("/pay-periods/:id/pay", verifyToken, authPermission, payPeriodController.pay);

/* LIQUIDACIÓN */
router.get("/payroll/:payPeriodId", verifyToken, authPermission, payrollController.getByPeriod);
router.post("/payroll/:payPeriodId/generate", verifyToken, authPermission, payrollController.generate);
router.put("/payroll/:id", verifyToken, authPermission, payrollController.update);
router.put("/payroll/:id/confirm", verifyToken, authPermission, payrollController.confirm);
router.put("/payroll/:id/pay", verifyToken, authPermission, payrollController.pay);

/* ADELANTOS */
router.get("/salary-advances", verifyToken, authPermission, salaryAdvanceController.getAll);
router.post("/salary-advances", verifyToken, authPermission, salaryAdvanceController.create);
router.put("/salary-advances/:id", verifyToken, authPermission, salaryAdvanceController.update);

/* EPP */
router.get("/safety-equipment", verifyToken, authPermission, safetyEquipmentController.getAll);
router.post("/safety-equipment", verifyToken, authPermission, safetyEquipmentController.create);
router.put("/safety-equipment/:id", verifyToken, authPermission, safetyEquipmentController.update);

/* CATÁLOGO EPP */
router.get("/epp-items", verifyToken, authPermission, eppItemController.getAll);
router.post("/epp-items", verifyToken, authPermission, eppItemController.create);
router.put("/epp-items/:id", verifyToken, authPermission, eppItemController.update);
router.put("/epp-items/:id/toggle", verifyToken, authPermission, eppItemController.toggleActive);

/* SELF-SERVICE (Portal del Empleado) — solo verifyToken, sin authPermission */
router.get("/me/profile", verifyToken, selfServiceController.getMyProfile);
router.get("/me/documents", verifyToken, selfServiceController.getMyDocuments);
router.get("/me/time-entries", verifyToken, selfServiceController.getMyTimeEntries);
router.get("/me/attendance", verifyToken, selfServiceController.getMyAttendance);
router.get("/me/safety-equipment", verifyToken, selfServiceController.getMySafetyEquipment);
router.get("/me/salary-advances", verifyToken, selfServiceController.getMyAdvances);
router.get("/me/payroll", verifyToken, selfServiceController.getMyPayroll);
router.get("/me/leave-requests", verifyToken, selfServiceController.getMyLeaveRequests);
router.get("/me/vacation-balance", verifyToken, selfServiceController.getMyVacationBalance);

/* LICENCIAS Y VACACIONES */
const uploadLeave = multer({ storage: multer.memoryStorage() });
router.get("/leave-requests", verifyToken, authPermission, leaveRequestController.getAll);
router.get("/leave-requests/balance/:employeeId", verifyToken, authPermission, leaveRequestController.getBalance);
router.post("/leave-requests", verifyToken, authPermission, uploadLeave.single('file'), leaveRequestController.create);
router.put("/leave-requests/:id/approve", verifyToken, authPermission, leaveRequestController.approve);
router.put("/leave-requests/:id/reject", verifyToken, authPermission, leaveRequestController.reject);
router.put("/leave-requests/:id/cancel", verifyToken, authPermission, leaveRequestController.cancel);

module.exports = router;
