# 上线部署手册（让顾客真机扫码可用）

> 目标：把"店里电脑 + 局域网"形态升级为"云服务器 + HTTPS + 已发布小程序"。
> 图例：💰 = 需要花钱　⚠ = 需要你本人操作的流程（实名/审核类，代码替代不了）　🤖 = 代码已备好

## 0. 总览与缺口

| 事项 | 状态 |
|---|---|
| 小程序代码（顾客点单全流程） | 🤖 已完成 |
| 后端安全加固（helmet/限流/请求体限制） | 🤖 已完成 |
| 微信静默登录 openid 归属 + 防刷追溯 | 🤖 已完成（配好密钥即生效） |
| 每桌小程序码生成 + 后台打印 | 🤖 已完成（配好密钥即生效） |
| pm2 进程守护 / SQLite 定时备份 | 🤖 已完成（需在服务器启用） |
| 新订单企业微信推送 | 🤖 已完成（配 Webhook 即生效） |
| 云服务器 + 域名 | 💰⚠ 需购买 |
| ICP 备案 | ⚠ 免费但需实名审核，1~3 周，**关键路径，最先启动** |
| HTTPS 证书 | 🤖 免费（Let's Encrypt / 云厂商免费证书） |
| 小程序 request 合法域名配置 + 提审发布 | ⚠ mp.weixin.qq.com 后台操作 |
| 微信支付 | 暂不做：需营业执照主体 + 商户号；当前"记账模式"（结桌标记收款方式）现实可用 |

## 1. 💰 买服务器和域名（第 1 天）

- 云服务器：任一家**国内**轻量应用服务器，2C2G 足够（约 ¥60~100/月）。系统选 Ubuntu 22.04/24.04
  - 必须国内节点：ICP 备案要求
- 域名：任意注册商，¥50/年左右；后缀随意（.cn/.com）
- 买完立刻在云控制台提交 **ICP 备案**（⚠ 实名认证 + 管局审核 1~3 周）。备案期间下面的步骤照做，只是域名暂时不能对外服务

## 2. 🤖 服务器初始化

```bash
# 安装 Node 22+（node:sqlite 要求 ≥22.5）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs pm2 nginx

# 拉代码（私有仓库先配 SSH key）
sudo mkdir -p /opt/qipaishi-pos && sudo chown $USER /opt/qipaishi-pos
git clone <你的仓库地址> /opt/qipaishi-pos
cd /opt/qipaishi-pos && npm ci --omit=dev
```

## 3. ⚠ 配置环境变量（密钥只在这里，不进代码库）

```bash
pm2 start ecosystem.config.js --update-env
# 环境变量建议写进 /etc/profile.d/qipaishi.sh 或 pm2 的 env 文件：
export PORT=3000
export ADMIN_PASSWORD='改成强密码！'        # 店长后台密码，别再使用 123456
export WX_APPID='wx77a1a1cd8dfa9da0'
export WX_SECRET='mp.weixin.qq.com 开发设置里生成'   # ⚠ 生成后只显示一次，妥善保存
export WEBHOOK_URL=''                      # 可选：企业微信群机器人 Webhook
```

```bash
pm2 save && pm2 startup    # 开机自启（按输出再执行一条 sudo 命令）
```

## 4. 🤖 定时备份

```bash
crontab -e
# 每天凌晨 4 点备份，日志进 backups/backup.log
0 4 * * * cd /opt/qipaishi-pos && node scripts/backup-db.js >> backups/backup.log 2>&1
```

> 建议再把 `backups/` 同步到异地（对象存储/另一台机器），整机丢失才不慌。恢复 = 停服务后用备份文件替换 `db/data.db`。

## 5. 🤖 nginx 反代 + HTTPS（备案通过后）

`/etc/nginx/sites-available/qipaishi`：

```nginx
server {
    listen 80;
    server_name pos.你的域名.cn;
    location / { return 301 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    server_name pos.你的域名.cn;
    ssl_certificate     /etc/letsencrypt/live/pos.你的域名.cn/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pos.你的域名.cn/privkey.pem;

    client_max_body_size 1m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pos.你的域名.cn     # 自动签证书+续期
sudo nginx -t && sudo systemctl reload nginx
```

> `X-Real-IP` 透传后，后端限流按真实顾客 IP 计数才准确（express-rate-limit 需信任代理：
> 在 `server/index.js` 加 `app.set('trust proxy', 1)`，nginx 反代场景下建议开启）。

## 6. ⚠ 微信小程序后台配置与发布

1. mp.weixin.qq.com →「开发管理 → 开发设置 → 服务器域名」：request 合法域名填 `https://pos.你的域名.cn`
2. 「成员管理」确认开发者；代码上传：微信开发者工具 → 上传（版本号如 1.0.0）
3. 「版本管理」提交审核：类目选**餐饮/生活服务类纯点单工具**定位（棋牌类目可能要求娱乐场所资质，提审前核实）；审核 1~7 天
4. 审核通过 → 发布为正式版
5. 店长后台「桌台看板 → 🖨 桌码」生成正式版每桌小程序码 → 打印贴桌（替换原 H5 二维码）

## 7. 切换验收清单（发布后逐项过）

- [ ] 真机扫 A1 桌码 → 直达开台确认弹层 → 开台成功
- [ ] 点单提交 → 店长后台 8 秒内"叮咚"提醒（或企业微信收到推送）
- [ ] 结桌 → 账单生成、小票打印正常
- [ ] 账单查询「进行中的桌台」实时区显示已接单订单
- [ ] 未登录状态直接 curl 顾客接口：限流生效（连续 21 次 POST 返回 429）
- [ ] `pm2 stop qipaishi-pos && pm2 start` 后数据完好（备份演练一次恢复流程）

## 8. 回滚预案

- 小程序：mp 后台「版本管理」可一键回退到上一正式版
- 服务器：`pm2 reload qipaishi-pos` 零停机重启；代码 `git revert` 后 reload
- 数据：用最近一份 `backups/data-*.db` 替换 `db/data.db` 后重启
