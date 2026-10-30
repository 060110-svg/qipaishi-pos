/**
 * 微信小程序对接封装：静默登录(code2session) + 每桌小程序码(getwxacodeunlimit) + 会话令牌
 * 未配置 WX_APPID/WX_SECRET 时 enabled()=false，接口返回明确提示、顾客端自动降级匿名，
 * 保证局域网试用不受影响。
 */
const crypto = require('crypto');
const config = require('./config');

function httpErr(status, msg) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

function enabled() {
  return Boolean(config.wx.appId && config.wx.appSecret);
}

/* ---------- access_token（有效期 2 小时，缓存到过期前 5 分钟） ---------- */
let tokenCache = { token: '', expireAt: 0 };

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expireAt) return tokenCache.token;
  const url = 'https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential'
    + `&appid=${config.wx.appId}&secret=${config.wx.appSecret}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) throw httpErr(502, `获取微信 access_token 失败：${data.errmsg || res.status}`);
  tokenCache = { token: data.access_token, expireAt: Date.now() + (data.expires_in - 300) * 1000 };
  return tokenCache.token;
}

/* ---------- 静默登录：wx.login 的 code → openid ---------- */
async function code2Session(code) {
  const url = 'https://api.weixin.qq.com/sns/jscode2session'
    + `?appid=${config.wx.appId}&secret=${config.wx.appSecret}`
    + `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!data.openid) throw httpErr(502, `微信登录失败：${data.errmsg || res.status}`);
  return { openid: data.openid };
}

/* ---------- 每桌小程序码：scene=桌台名（≤32 字符），page 必须是已发布页面 ---------- */
async function getTableQrcode(scene, envVersion = 'release') {
  const token = await getAccessToken();
  const res = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene,
      page: 'pages/tables/tables',
      width: 430,
      env_version: envVersion,           // release=正式版 trial=体验版 develop=开发版
      auto_color: false,
      line_color: { r: 79, g: 70, b: 229 }, // 与界面同款靛蓝
    }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  // 成功返回图片二进制；失败返回很小的 JSON（errcode/errmsg）
  if (buf.length < 1024 && buf.slice(0, 1).toString('utf8') === '{') {
    const data = JSON.parse(buf.toString('utf8'));
    throw httpErr(502, `生成小程序码失败：${data.errmsg || '未知错误'}（env=${envVersion}，需该版本已发布过）`);
  }
  return buf;
}

/* ---------- 顾客会话令牌（内存存储，重启后顾客端会自动重新静默登录） ---------- */
const sessions = new Map(); // token -> { openid, expireAt }
const SESSION_TTL = 12 * 3600 * 1000;

function issueToken(openid) {
  // 顺手清理过期会话，避免长时间运行后内存膨胀
  if (sessions.size > 500) {
    const now = Date.now();
    for (const [k, v] of sessions) if (now > v.expireAt) sessions.delete(k);
  }
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { openid, expireAt: Date.now() + SESSION_TTL });
  return token;
}

function openidOf(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expireAt) { sessions.delete(token); return null; }
  return s.openid;
}

module.exports = { enabled, code2Session, getTableQrcode, issueToken, openidOf };
