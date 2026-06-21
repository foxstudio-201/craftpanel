// PM2 process file — optional alternative to systemd.
//
//   sudo -u craftpanel pm2 start ecosystem.config.js   # start
//   sudo -u craftpanel pm2 logs craftpanel             # live logs
//   sudo -u craftpanel pm2 restart craftpanel          # restart
//   sudo -u craftpanel pm2 save                        # persist process list
//   pm2 startup systemd -u craftpanel --hp /opt/craftpanel   # resurrect on boot
//
// The installer wires all of this up automatically when run with USE_PM2=1.

module.exports = {
  apps: [
    {
      name: 'craftpanel',
      script: 'src/server.js',
      cwd: __dirname,
      exec_mode: 'fork',   // single instance: app holds Socket.IO + Docker streams + SFTP
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,
      kill_timeout: 20000,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOST: '0.0.0.0',
      },
      // PM2-managed log files (alternative to journalctl).
      out_file: '/var/log/craftpanel/out.log',
      error_file: '/var/log/craftpanel/error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
