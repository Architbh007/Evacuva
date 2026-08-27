const path = require("node:path");

module.exports = {
  uiHost: "127.0.0.1",
  uiPort: 1880,
  httpStatic: path.join(__dirname, "public"),
  httpStaticRoot: "/app/",
  flowFilePretty: true,
  credentialSecret: false,
  editorTheme: {
    projects: {
      enabled: false,
    },
  },
  logging: {
    console: {
      level: "info",
      metrics: false,
      audit: false,
    },
  },
};
