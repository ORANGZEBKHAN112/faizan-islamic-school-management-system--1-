/** PM2 config — run from app root: pm2 start deploy/pm2/ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: "fiss-erp",
      cwd: process.env.FISS_APP_DIR || "/var/www/fiss-erp",
      script: "server.ts",
      interpreter: "./node_modules/.bin/tsx",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
      max_memory_restart: "512M",
      error_file: "/var/log/fiss-erp/error.log",
      out_file: "/var/log/fiss-erp/out.log",
      merge_logs: true,
      time: true,
    },
  ],
};
