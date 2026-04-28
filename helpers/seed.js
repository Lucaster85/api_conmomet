const { encryptPass } = require('./encryptPass');

const INITIAL_PERMISSIONS = [
  'admin_granted',
  'users_read', 'users_write', 'users_update', 'users_delete',
  'roles_read', 'roles_write', 'roles_update', 'roles_delete',
  'permissions_read', 'permissions_write', 'permissions_update', 'permissions_delete',
  'media_read', 'media_write', 'media_update', 'media_delete',
  'clients_read', 'clients_write', 'clients_update', 'clients_delete',
  'providers_read', 'providers_write', 'providers_update', 'providers_delete',
  'plants_read', 'plants_write', 'plants_update', 'plants_delete',
  'employees_read', 'employees_write', 'employees_update', 'employees_delete',
  'documents_read', 'documents_write', 'documents_update', 'documents_delete',
  'time_entries_read', 'time_entries_write', 'time_entries_update', 'time_entries_void',
  'attendance_read', 'attendance_write', 'attendance_update',
  'pay_periods_read', 'pay_periods_write', 'pay_periods_update',
  'payroll_read', 'payroll_write', 'payroll_update',
  'salary_advances_read', 'salary_advances_write', 'salary_advances_update',
  'safety_equipment_read', 'safety_equipment_write', 'safety_equipment_update',
  'epp_items_read', 'epp_items_write', 'epp_items_update',
];

async function seedPermissions(db) {
  const existing = await db.Permission.findAll({ attributes: ['name'], paranoid: false });
  const existingNames = new Set(existing.map(p => p.name));

  const toCreate = INITIAL_PERMISSIONS.filter(name => !existingNames.has(name));
  if (toCreate.length > 0) {
    await db.Permission.bulkCreate(toCreate.map(name => ({ name })));
    console.log(`[seed] Permisos creados: ${toCreate.join(', ')}`);
  }
}

async function seedAdminRole(db) {
  let adminRole = await db.Role.findOne({ where: { name: 'admin' }, paranoid: false });
  if (!adminRole) {
    adminRole = await db.Role.create({ name: 'admin' });
    console.log('[seed] Rol admin creado');
  }

  const adminGranted = await db.Permission.findOne({ where: { name: 'admin_granted' }, paranoid: false });
  if (!adminGranted) return;

  const rolePerms = await adminRole.getPermissions();
  const hasAdminGranted = rolePerms.some(p => p.name === 'admin_granted');
  if (!hasAdminGranted) {
    await adminRole.addPermission(adminGranted);
    console.log('[seed] admin_granted asignado al rol admin');
  }

  return adminRole;
}

async function seedAdminUser(db, adminRole) {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@mail.com';
  let adminUser = await db.User.findOne({ where: { email: adminEmail }, paranoid: false });

  if (!adminUser) {
    const hashPass = await encryptPass(process.env.ADMIN_PASSWORD || '123456');
    adminUser = await db.User.create({
      name: process.env.ADMIN_NAME || 'admin',
      lastname: process.env.ADMIN_LASTNAME || 'admin',
      email: adminEmail,
      password: hashPass,
      role_id: adminRole.id,
      cuit: process.env.ADMIN_CUIT || 11111111111,
      phone: process.env.ADMIN_PHONE || '1111111111',
      celphone: process.env.ADMIN_CELPHONE || '1111111111',
    });
    console.log(`[seed] Usuario admin creado: ${adminEmail}`);
  } else if (adminRole && adminUser.role_id !== adminRole.id) {
    // Asegurar que el usuario admin tenga el rol admin
    await adminUser.update({ role_id: adminRole.id });
    console.log('[seed] Rol admin asignado al usuario admin');
  }
}

async function runSeed(db) {
  try {
    await seedPermissions(db);
    const adminRole = await seedAdminRole(db);
    if (adminRole) await seedAdminUser(db, adminRole);
  } catch (error) {
    console.error('[seed] Error en seed inicial:', error.message);
  }
}

module.exports = { runSeed };
