const db = require("../models");
const { Op } = require("sequelize");
const { uploadToR2, deleteFromR2 } = require("../helpers");

// Helper to calculate corresponding vacation days based on hire_date
const calculateVacationDays = (hireDate) => {
  if (!hireDate) return 0;
  
  const today = new Date();
  const currentYear = today.getFullYear();
  // Law dictates computing seniority as of Dec 31 of the current year
  const computeDate = new Date(currentYear, 11, 31);
  const hire = new Date(hireDate);
  
  // Calculate difference in milliseconds
  const diffTime = Math.abs(computeDate - hire);
  const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);

  if (diffYears <= 5) return 14;
  if (diffYears <= 10) return 21;
  if (diffYears <= 20) return 28;
  return 35;
};

const mapLeaveTypeToAttendanceStatus = (leaveType) => {
  switch (leaveType) {
    case 'vacation': return 'vacation';
    case 'medical_leave': return 'medical_leave';
    case 'justified': return 'justified';
    default: return 'absent';
  }
};

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id, leave_type, status, year } = req.query;
      const where = {};

      if (employee_id) where.employee_id = employee_id;
      if (leave_type) where.leave_type = leave_type;
      if (status) where.status = status;
      
      if (year) {
        where.start_date = {
          [Op.gte]: `${year}-01-01`,
          [Op.lte]: `${year}-12-31`,
        };
      }

      const { count, rows } = await db.LeaveRequest.findAndCountAll({
        where,
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname", "dni"] },
          { model: db.User, as: "requester", attributes: ["id", "name", "lastname"] },
          { model: db.User, as: "approver", attributes: ["id", "name", "lastname"] },
        ],
        order: [["start_date", "DESC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  getBalance: async (req, res) => {
    try {
      const employeeId = req.params.employeeId;
      const employee = await db.Employee.findByPk(employeeId);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado" });

      // Determine corresponding days
      const correspondingDays = employee.vacation_days_override !== null 
        ? employee.vacation_days_override 
        : calculateVacationDays(employee.hire_date);

      // Get used days for current year
      const currentYear = new Date().getFullYear();
      
      const usedDaysResult = await db.LeaveRequest.sum('total_days', {
        where: {
          employee_id: employeeId,
          leave_type: 'vacation',
          status: 'approved',
          start_date: {
            [Op.gte]: `${currentYear}-01-01`,
            [Op.lte]: `${currentYear}-12-31`,
          }
        }
      });
      
      const usedDays = usedDaysResult || 0;
      const balance = correspondingDays - usedDays;

      return res.status(200).json({
        data: {
          corresponding_days: correspondingDays,
          used_days: usedDays,
          balance: balance,
        }
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { employee_id, leave_type, start_date, end_date, notes } = req.body;
      const file = req.file;

      if (!employee_id || !leave_type || !start_date || !end_date) {
        return res.status(400).json({ error: "Faltan campos obligatorios" });
      }

      const start = new Date(start_date);
      const end = new Date(end_date);
      if (end < start) {
        return res.status(400).json({ error: "La fecha de fin no puede ser menor a la fecha de inicio" });
      }

      // Calculate total days (inclusive)
      const total_days = Math.round(Math.abs(end - start) / (1000 * 60 * 60 * 24)) + 1;

      // File upload
      let document_url = null;
      let document_key = null;
      let document_name = null;

      if (file) {
        const folder = `employees/${employee_id}/leave-requests`;
        document_url = await uploadToR2(file, folder);
        document_key = document_url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");
        document_name = file.originalname;
      }

      const leaveRequest = await db.LeaveRequest.create({
        employee_id,
        leave_type,
        start_date,
        end_date,
        total_days,
        notes,
        status: 'pending',
        document_url,
        document_key,
        document_name,
        requested_by: req.user ? req.user.id : null,
      });

      return res.status(201).json({ data: leaveRequest });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  approve: async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const leaveRequest = await db.LeaveRequest.findByPk(req.params.id);
      if (!leaveRequest) {
        await t.rollback();
        return res.status(404).json({ error: "Solicitud no encontrada" });
      }

      if (leaveRequest.status !== 'pending') {
        await t.rollback();
        return res.status(400).json({ error: `No se puede aprobar una solicitud en estado: ${leaveRequest.status}` });
      }

      await leaveRequest.update({
        status: 'approved',
        approved_by: req.user ? req.user.id : null,
        approved_at: new Date(),
      }, { transaction: t });

      // Generate Attendance records
      const start = new Date(leaveRequest.start_date);
      // Create a local date without timezone issues
      const currentDate = new Date(start.getTime() + start.getTimezoneOffset() * 60000);
      const endDateStr = leaveRequest.end_date;

      let currentDateStr = currentDate.toISOString().split("T")[0];
      
      while (currentDateStr <= endDateStr) {
        // Check if attendance already exists for this date to avoid duplicates
        const existing = await db.Attendance.findOne({
          where: { employee_id: leaveRequest.employee_id, date: currentDateStr },
          transaction: t,
        });

        if (!existing) {
          await db.Attendance.create({
            employee_id: leaveRequest.employee_id,
            date: currentDateStr,
            status: mapLeaveTypeToAttendanceStatus(leaveRequest.leave_type),
            notes: `Generado automáticamente — Solicitud #${leaveRequest.id}`,
            document_url: leaveRequest.document_url,
            document_key: leaveRequest.document_key,
            document_name: leaveRequest.document_name,
          }, { transaction: t });
        } else {
           // update existing if needed? For now we just skip or maybe we update. Better to overwrite.
           await existing.update({
            status: mapLeaveTypeToAttendanceStatus(leaveRequest.leave_type),
            notes: `Sobrescrito automáticamente — Solicitud #${leaveRequest.id}`,
           }, { transaction: t });
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
        currentDateStr = currentDate.toISOString().split("T")[0];
      }

      await t.commit();
      return res.status(200).json({ data: leaveRequest });
    } catch (error) {
      await t.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  reject: async (req, res) => {
    try {
      const leaveRequest = await db.LeaveRequest.findByPk(req.params.id);
      if (!leaveRequest) return res.status(404).json({ error: "Solicitud no encontrada" });

      if (leaveRequest.status !== 'pending') {
        return res.status(400).json({ error: `No se puede rechazar una solicitud en estado: ${leaveRequest.status}` });
      }

      await leaveRequest.update({
        status: 'rejected',
        notes: req.body.notes ? `${leaveRequest.notes || ''}\nRechazo: ${req.body.notes}` : leaveRequest.notes,
      });

      return res.status(200).json({ data: leaveRequest });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  cancel: async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const leaveRequest = await db.LeaveRequest.findByPk(req.params.id);
      if (!leaveRequest) {
        await t.rollback();
        return res.status(404).json({ error: "Solicitud no encontrada" });
      }

      if (leaveRequest.status === 'cancelled') {
        await t.rollback();
        return res.status(400).json({ error: "La solicitud ya está cancelada" });
      }

      const previousStatus = leaveRequest.status;

      await leaveRequest.update({
        status: 'cancelled',
      }, { transaction: t });

      // If it was approved, we need to delete the attendance records
      if (previousStatus === 'approved') {
        await db.Attendance.destroy({
          where: {
            employee_id: leaveRequest.employee_id,
            date: {
              [Op.between]: [leaveRequest.start_date, leaveRequest.end_date],
            },
            notes: {
              [Op.like]: `%Solicitud #${leaveRequest.id}%`
            }
          },
          transaction: t,
        });
      }

      await t.commit();
      return res.status(200).json({ data: leaveRequest });
    } catch (error) {
      await t.rollback();
      return res.status(500).json({ error: error.message });
    }
  },
};
