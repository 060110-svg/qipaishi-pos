const api = require('./utils/api.js');

/**
 * 小程序入口：解析扫码参数、静默登录绑定 openid、维护当前桌台
 * 扫码进入：小程序码 scene 为桌台名（如 A1）或 table=A1；普通进入也可带 query table=A1
 */
App({
  globalData: {
    table: null,       // 当前桌台对象
    sceneTable: '',    // 扫码带入的桌台名（tables 页消费一次）
    isAdmin: false,    // 是否为店长模式
  },

  onLaunch(options) {
    // 普通启动/链接参数 table=A1（或 id=A1）。
    // 注意：onLaunch 的 options.scene 是"进入场景值"编号（如扫码=1047），不是自定义参数；
    // 小程序码的自定义 scene 字符串在页面 onLoad(options).scene 里解析，见 tables 页。
    const q = options.query || {};
    const name = q.table || q.id || '';
    if (name) this.globalData.sceneTable = name;

    // 恢复店长登录状态
    const isAdmin = wx.getStorageSync('isAdmin');
    if (isAdmin) {
      this.globalData.isAdmin = true;
    } else {
      this.wxLogin();
    }
  },

  // 静默登录：拿 openid 会话令牌，开台/下单自动带上用于归属与防刷。
  // 后端未配置微信或失败时静默降级为匿名，不影响点单流程。
  wxLogin() {
    wx.login({
      success: (res) => {
        if (!res.code) return;
        api.request('/wx/login', { method: 'POST', body: { code: res.code } })
          .then((r) => { if (r && r.ok) wx.setStorageSync('wxToken', r.token); })
          .catch(() => { /* 匿名降级 */ });
      },
    });
  },

  setTable(t) {
    this.globalData.table = t;
    wx.setStorageSync('currentTableId', t.id);
  },
  clearTable() {
    this.globalData.table = null;
    wx.removeStorageSync('currentTableId');
  },

  // 切换店长/顾客模式
  setAdminMode(isAdmin) {
    this.globalData.isAdmin = isAdmin;
    wx.setStorageSync('isAdmin', isAdmin);
  },
});
