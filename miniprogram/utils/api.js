/**
 * 后端请求封装：与网页端 /api 完全同一套接口，顾客端无需登录
 */
const { BASE_URL } = require('./config.js');

function request(path, { method = 'GET', body } = {}) {
  const header = { 'Content-Type': 'application/json' };
  const wxToken = wx.getStorageSync('wxToken');
  if (wxToken) header['x-wx-token'] = wxToken; // 静默登录会话（匿名时不带）
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
