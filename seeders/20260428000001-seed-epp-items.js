"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    await queryInterface.bulkInsert("EppItems", [
      // Footwear
      { name: "Botín de Seguridad", category: "footwear", size_type: "numeric", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Bota de Goma", category: "footwear", size_type: "numeric", is_active: true, created_at: new Date(), updated_at: new Date() },

      // Clothing
      { name: "Camiseta de Trabajo", category: "clothing", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Pantalón de Trabajo", category: "clothing", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Campera de Trabajo", category: "clothing", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Mameluco", category: "clothing", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Chaleco Reflectivo", category: "clothing", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },

      // Head Protection
      { name: "Casco de Seguridad", category: "head_protection", size_type: "none", is_active: true, created_at: new Date(), updated_at: new Date() },

      // Hand Protection
      { name: "Guantes de Soldador", category: "hand_protection", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Guantes de Descarne", category: "hand_protection", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Guantes de Látex", category: "hand_protection", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },

      // Eye Protection
      { name: "Antiparras", category: "eye_protection", size_type: "none", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Máscara de Soldador", category: "eye_protection", size_type: "none", is_active: true, created_at: new Date(), updated_at: new Date() },

      // Other
      { name: "Protector Auditivo", category: "other", size_type: "none", is_active: true, created_at: new Date(), updated_at: new Date() },
      { name: "Arnés de Seguridad", category: "other", size_type: "alpha", is_active: true, created_at: new Date(), updated_at: new Date() },
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete("EppItems", null, {});
  },
};
