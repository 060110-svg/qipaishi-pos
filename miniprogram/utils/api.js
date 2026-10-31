/**
 * 后端请求封装：与网页端 /api 完全同一套接口，顾客端无需登录
 */
const { BASE_URL } = require('./config.js');

function request(path, { method = 'GET', body } = {}) {
  const header = { 'Content-Type': 'application/json' };

  // 优先使用店长令牌（店长模式）
  const adminToken = wx.getStorageSync('adminToken');
  const isAdmin = wx.getStorageSync('isAdmin');
  if (isAdmin && adminToken) {
    header['x-admin-token'] = adminToken;
  } else {
    // 顾客模式：使用微信静默登录令牌
    const wxToken = wx.getStorageSync('wxToken');
    if (wxToken) header['x-wx-token'] = wxToken;
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + '/api' + path,
      method,
      data: body,
      header,
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data);
        else reject(new Error((res.data && res.data.error) || `请求失败(${res.statusCode})`));
      },
      fail() {
        reject(new Error('连不上收银电脑，请确认在同一WiFi且服务已启动'));
      },
    });
  });
}

function toast(title, icon = 'none') {
  wx.showToast({ title: String(title).slice(0, 40), icon, duration: 2500 });
}

const money = (n) => '¥' + Number(n || 0).toFixed(2);

module.exports = { request, toast, money };
