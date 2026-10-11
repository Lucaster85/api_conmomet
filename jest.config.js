"use strict";
// Dos projects: `unit` no toca la DB y corre en paralelo (son los que van al hook de
// pre-push); `integration` sí, y corre en serie — comparten la misma base de test y el
// truncate de cada test no sería seguro con workers concurrentes. `maxWorkers` no se puede
// fijar por project (Jest lo exige a nivel raíz, y ahí aplicaría también a `unit`), así que la
// serialización de integration la fuerza `--runInBand` en el script `test:integration` del
// package.json — no correr ese project sin esa flag.
module.exports = {
  projects: [
    {
      displayName: "unit",
      testEnvironment: "node",
      testMatch: ["<rootDir>/test/unit/**/*.test.js"],
    },
    {
      displayName: "integration",
      testEnvironment: "node",
      testMatch: ["<rootDir>/test/integration/**/*.test.js"],
      globalSetup: "<rootDir>/test/setup/globalSetup.js",
      setupFilesAfterEnv: ["<rootDir>/test/setup/truncate.js"],
    },
  ],
};
