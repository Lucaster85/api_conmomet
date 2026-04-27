const db = require("../models");
const { Op } = require("sequelize");

// Helper para obtener el empleado vinculado al usuario logueado
const getMyEmployee = async (userId) => {
    return await db.Employee.findOne({ where: { user_id: userId } });
};

module.exports = {
    getMyProfile: async (req, res) => {
        try {
            const employee = await getMyEmployee(req.user.id);
            if (!employee) return res.status(403).json({ error: "No tenés un legajo de empleado vinculado." });

            return res.status(200).json({ data: employee });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },

    getMyDocuments: async (req, res) => {
        try {
            const employee = await getMyEmployee(req.user.id);
            if (!employee) return res.status(403).json({ error: "No tenés un legajo de empleado vinculado." });

            const documents = await db.EntityDocument.findAll({
                where: {
                    entity_type: 'employee',
                    entity_id: employee.id
                },
                order: [['created_at', 'DESC']]
            });

            return res.status(200).json({ data: documents });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },

    getMyTimeEntries: async (req, res) => {
        try {
            const employee = await getMyEmployee(req.user.id);
            if (!employee) return res.status(403).json({ error: "No tenés un legajo de empleado vinculado." });

            const { from, to } = req.query;
            let whereClause = { employee_id: employee.id };

            if (from || to) {
                whereClause.date = {};
                if (from) whereClause.date[Op.gte] = from;
                if (to) whereClause.date[Op.lte] = to;
            }

            const entries = await db.TimeEntry.findAll({
                where: whereClause,
                order: [['date', 'DESC']]
            });

            return res.status(200).json({ data: entries });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },

    getMyAttendance: async (req, res) => {
        try {
            const employee = await getMyEmployee(req.user.id);
            if (!employee) return res.status(403).json({ error: "No tenés un legajo de empleado vinculado." });

            const attendances = await db.Attendance.findAll({
                where: { employee_id: employee.id },
                order: [['date', 'DESC']]
            });

            return res.status(200).json({ data: attendances });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },

    getMySafetyEquipment: async (req, res) => {
        try {
            const employee = await getMyEmployee(req.user.id);
            if (!employee) return res.status(403).json({ error: "No tenés un legajo de empleado vinculado." });

            const equipments = await db.SafetyEquipment.findAll({
                where: { employee_id: employee.id },
                include: [{
                    model: db.EppItem,
                    as: 'eppItem'
                }],
                order: [['delivered_date', 'DESC']]
            });

            return res.status(200).json({ data: equipments });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },

    getMyAdvances: async (req, res) => {
        try {
            const employee = await getMyEmployee(req.user.id);
            if (!employee) return res.status(403).json({ error: "No tenés un legajo de empleado vinculado." });

            const advances = await db.SalaryAdvance.findAll({
                where: { employee_id: employee.id },
                order: [['date', 'DESC']]
            });

            return res.status(200).json({ data: advances });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    },

    getMyPayroll: async (req, res) => {
        try {
            const employee = await getMyEmployee(req.user.id);
            if (!employee) return res.status(403).json({ error: "No tenés un legajo de empleado vinculado." });

            // Only return confirmed or paid payroll entries
            const payrolls = await db.PayrollEntry.findAll({
                where: { 
                    employee_id: employee.id,
                    status: {
                        [Op.in]: ['confirmed', 'paid']
                    }
                },
                include: [{
                    model: db.PayPeriod,
                    as: 'payPeriod'
                }],
                order: [['created_at', 'DESC']]
            });

            return res.status(200).json({ data: payrolls });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
};
