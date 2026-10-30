/**
 * pm2 进程守护配置：服务器上执行 pm2 start ecosystem.config.js
 * 崩溃自动重启；开机自启需再执行 pm2 save && pm2 startup（按提示复制命令运行）
 */
module.exports = {
  apps: [{
    name: 'qipaishi-pos',
    script: 'server/index.js',
    node_args: '--disable-warning=ExperimentalWarning',
    restart_delay: 3000,
    max_restarts: 50,
    env: { NODE_ENV: 'production', PORT: 3000 },
  }],
};
