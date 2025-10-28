Guia de instalacion de proyecto

node version  > 22
base de datos mariadb
copiar .env.example -> .env
correr migraciones -> npm run migrate:up

MYSQL instalacion version 9.5.0

la migracion inicial crea un usuario superAdmin con las credenciales definidas en el .env

crear una nueva migracion
    npx sequelize-cli migration:generate --name {name}

