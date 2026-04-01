require('dotenv').config();

module.exports = {
  development: {
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASS,
    database: process.env.DATABASE_NAME,
    host: process.env.DATABASE_HOST,
    dialect: "mysql",
    timezone: "-03:00"
  },
  production: {
    url: process.env.DATABASE_URL,
    dialect: "mysql",
    timezone: "-03:00"
  }
}
