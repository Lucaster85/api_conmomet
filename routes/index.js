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
const holidayController = require("../controllers/holidayController");
const payrollConceptController = require("../controllers/payrollConceptController");
const employeeRateController = require("../controllers/employeeRateController");
const categoriaController = require("../controllers/categoryController");
const projectController = require("../controllers/projectController");
const documentCategoryController = require("../controllers/documentCategoryController");
const plantRequirementController = require("../controllers/plantRequirementController");
const complianceController = require("../controllers/complianceController");
const guildController = require("../controllers/guildController");
const employerCostCategoryController = require("../controllers/employerCostCategoryController");
const employerCostController = require("../controllers/employerCostController");
const payrollAdjustmentController = require("../controllers/payrollAdjustmentController");
const loanController = require("../controllers/loanController");
const loanPaymentController = require("../controllers/loanPaymentController");
const rateChangeController = require("../controllers/rateChangeController");
const expenseSummaryController = require("../controllers/expenseSummaryController");

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
// TODO: [LOOKUP ENDPOINTS] Crear endpoints "lite" de solo lectura para poblar selects
// sin requerir permisos de gestión completa del recurso. Ejemplo:
//   GET /lookup/roles       → solo verifyToken, devuelve [{id, name}] (sin permissions incluidos)
//   GET /lookup/permissions  → solo verifyToken, devuelve [{id, name}]
// Esto permite que un rol "Administrador" con users_write (pero sin roles_read)
// pueda poblar el select de roles al crear usuarios, sin ver el menú "Roles y Permisos".
// Patrón: router.get("/lookup/roles", verifyToken, lookupController.roles);
// Ver también: conmomet-app/src/app/dashboard/users/UserForm.tsx (consume RoleService.getAll)
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
router.get("/payroll/entry/:id/lines", verifyToken, authPermission, payrollController.getLines);
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

/* FERIADOS */
router.get("/holidays", verifyToken, authPermission, holidayController.getAll);
router.post("/holidays", verifyToken, authPermission, holidayController.create);
router.post("/holidays/bulk", verifyToken, authPermission, holidayController.bulkCreate);
router.put("/holidays/:id", verifyToken, authPermission, holidayController.update);
router.delete("/holidays/:id", verifyToken, authPermission, holidayController.destroy);

/* CONCEPTOS DE LIQUIDACIÓN */
router.get("/payroll-concepts", verifyToken, authPermission, payrollConceptController.getAll);
router.post("/payroll-concepts", verifyToken, authPermission, payrollConceptController.create);
router.put("/payroll-concepts/:id", verifyToken, authPermission, payrollConceptController.update);
router.delete("/payroll-concepts/:id", verifyToken, authPermission, payrollConceptController.destroy);

/* TARIFAS POR EMPLEADO */
router.get("/employee-rates/:employeeId", verifyToken, authPermission, employeeRateController.getByEmployee);
router.post("/employee-rates", verifyToken, authPermission, employeeRateController.upsert);
router.post("/employee-rates/bulk", verifyToken, authPermission, employeeRateController.bulkSave);
router.delete("/employee-rates/:id", verifyToken, authPermission, employeeRateController.destroy);

/* CATEGORIES */
router.get("/categories", verifyToken, authPermission, categoriaController.getAll);
router.get("/categories/:id", verifyToken, authPermission, categoriaController.get);
router.post("/categories", verifyToken, authPermission, categoriaController.create);
router.put("/categories/:id", verifyToken, authPermission, categoriaController.update);
router.delete("/categories/:id", verifyToken, authPermission, categoriaController.destroy);

/* PROYECTOS */
router.get("/projects", verifyToken, authPermission, projectController.getAll);
router.get("/projects/:id", verifyToken, authPermission, projectController.get);
router.post("/projects", verifyToken, authPermission, projectController.create);
router.put("/projects/:id", verifyToken, authPermission, projectController.update);
router.delete("/projects/:id", verifyToken, authPermission, projectController.destroy);

/* CATEGORÍAS DE DOCUMENTOS */
router.get("/document-categories", verifyToken, authPermission, documentCategoryController.getAll);
router.get("/document-categories/:id", verifyToken, authPermission, documentCategoryController.get);
router.post("/document-categories", verifyToken, authPermission, documentCategoryController.create);
router.put("/document-categories/:id", verifyToken, authPermission, documentCategoryController.update);
router.delete("/document-categories/:id", verifyToken, authPermission, documentCategoryController.destroy);

/* REQUISITOS DE PLANTA */
router.get("/plants/:id/requirements", verifyToken, authPermission, plantRequirementController.getAll);
router.post("/plants/:id/requirements", verifyToken, authPermission, plantRequirementController.create);
router.put("/plants/:id/requirements/:reqId", verifyToken, authPermission, plantRequirementController.update);
router.delete("/plants/:id/requirements/:reqId", verifyToken, authPermission, plantRequirementController.destroy);

/* HABILITACIONES / COMPLIANCE */
router.get("/plants/:id/compliance", verifyToken, authPermission, complianceController.getPlantCompliance);
router.get("/projects/:id/team", verifyToken, authPermission, complianceController.getProjectTeam);


/* GREMIOS */
router.get("/guilds", verifyToken, authPermission, guildController.getAll);
router.get("/guilds/:id", verifyToken, authPermission, guildController.getById);
router.post("/guilds", verifyToken, authPermission, guildController.create);
router.put("/guilds/:id", verifyToken, authPermission, guildController.update);
router.delete("/guilds/:id", verifyToken, authPermission, guildController.delete);

/* COSTOS LABORALES - CATEGORIAS */
router.get("/employer-cost-categories", verifyToken, authPermission, employerCostCategoryController.getAll);
router.get("/employer-cost-categories/:id", verifyToken, authPermission, employerCostCategoryController.getById);
router.post("/employer-cost-categories", verifyToken, authPermission, employerCostCategoryController.create);
router.put("/employer-cost-categories/:id", verifyToken, authPermission, employerCostCategoryController.update);
router.delete("/employer-cost-categories/:id", verifyToken, authPermission, employerCostCategoryController.delete);

/* COSTOS LABORALES */
router.get("/employer-costs", verifyToken, authPermission, employerCostController.getAll);
router.get("/employer-costs/:id", verifyToken, authPermission, employerCostController.getById);
router.post("/employer-costs", verifyToken, authPermission, upload.single('file'), employerCostController.create);
router.put("/employer-costs/:id", verifyToken, authPermission, upload.single('file'), employerCostController.update);
router.delete("/employer-costs/:id", verifyToken, authPermission, employerCostController.delete);

/* AJUSTES DE LIQUIDACION */
router.get("/payroll-adjustments", verifyToken, authPermission, payrollAdjustmentController.getAll);
router.post("/payroll-adjustments", verifyToken, authPermission, payrollAdjustmentController.create);
router.put("/payroll-adjustments/:id", verifyToken, authPermission, payrollAdjustmentController.update);
router.delete("/payroll-adjustments/:id", verifyToken, authPermission, payrollAdjustmentController.delete);

/* PRESTAMOS */
router.get("/loans", verifyToken, authPermission, loanController.getAll);
router.get("/loans/:id", verifyToken, authPermission, loanController.getById);
router.post("/loans", verifyToken, authPermission, loanController.create);
router.put("/loans/:id", verifyToken, authPermission, loanController.update);
router.delete("/loans/:id", verifyToken, authPermission, loanController.delete);

/* PAGOS DE PRESTAMOS */
router.post("/loan-payments", verifyToken, authPermission, loanPaymentController.create);
router.delete("/loan-payments/:id", verifyToken, authPermission, loanPaymentController.delete);

/* RETROACTIVOS (RATE CHANGES) */
router.get("/rate-changes", verifyToken, authPermission, rateChangeController.getAll);
router.post("/rate-changes", verifyToken, authPermission, rateChangeController.create);
router.delete("/rate-changes/:id", verifyToken, authPermission, rateChangeController.delete);
router.post("/rate-changes/:id/preview", verifyToken, authPermission, rateChangeController.preview);

/* RESUMEN DE COSTOS */
router.get("/expense-summary/monthly", verifyToken, authPermission, expenseSummaryController.monthly);
router.get("/expense-summary/annual", verifyToken, authPermission, expenseSummaryController.annual);

module.exports = router;
