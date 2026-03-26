const fs = require("fs");
const path = require("path");

/** Fresh userData for each full test run (see `e2eBootstrap` + `HARNESS_E2E`). */
module.exports = async function globalSetup() {
  const dir = path.join(process.cwd(), ".e2e-user-data");
  fs.rmSync(dir, { recursive: true, force: true });
};
