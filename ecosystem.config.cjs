module.exports = {
  apps: [
    {
      name: "mcp-file-server",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/server.ts",
      interpreter: "node",
      cwd: __dirname,
      env: { PORT: "3000" },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "5s",
      restart_delay: 2000,
    },
    {
      name: "ngrok-tunnel",
      script:
        "C:\\Users\\Christine\\AppData\\Local\\Microsoft\\WinGet\\Links\\ngrok.exe",
      args: "http --url=explain-liking-chase.ngrok-free.dev 3000",
      interpreter: "none",
      autorestart: true,
      restart_delay: 3000,
    },
  ],
};
