/**
 * 店长管理主页 - 数据看板 + 新订单提醒 + 管理入口
 */
const api = require('../../utils/api.js');

Page({
  data: {
    stats: {
      occupiedTables: 0,
      totalTables: 0,
      pendingOrders: 0,
      todayRevenue: '0.00',
    },
    newOrders: [],
  },

  _pollTimer: null,
  _lastOrderId: 0,

  onLoad() {
    // 未登录店长则跳登录页
    if (!wx.getStorageSync('isAdmin') || !wx.getStorageSync('adminToken')) {
      wx.redirectTo({ url: '/pages/admin/login' });
      return;
    }
    this._lastOrderId = wx.getStorageSync('lastOrderId') || 0;
  },

  onShow() {
    if (!wx.getStorageSync('isAdmin')) return;
    this.loadStats();
    this.startPolling();
  },

  onHide() {
    this.stopPolling();
  },

  onUnload() {
    this.stopPolling();
  },

  async loadStats() {
    try {
      const [tables, orders, bills] = await Promise.all([
        api.request('/tables'),
        api.request('/orders?status=pending'),
        api.request('/bills'),
      ]);

      // 今日营收：今天结桌的账单合计
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const todayRevenue = (bills || [])
        .filter((b) => (b.settled_at || '').slice(0, 10) === today)
        .reduce((sum, b) => sum + Number(b.total_amount || 0), 0);

      this.setData({
        stats: {
          occupiedTables: tables.filter((t) => t.status === 'occupied').length,
          totalTables: tables.length,
          pendingOrders: orders.length,
          todayRevenue: todayRevenue.toFixed(2),
        },
      });

      // 同步新订单基线（首次进入时以当前最大订单 id 为基线，避免历史订单全部弹出）
      if (!this._lastOrderId && orders.length >= 0) {
        const all = await api.request('/orders?limit=1');
        if (all && all[0]) {
          this._lastOrderId = all[0].id;
          wx.setStorageSync('lastOrderId', this._lastOrderId);
        }
      }
    } catch (e) {
      // 401 = 令牌过期（服务重启后内存令牌失效）
      if (/登录/.test(e.message)) this.handleAuthFail();
      else api.toast(e.message);
    }
  },

  // ---------- 新订单轮询 ----------
  startPolling() {
    this.stopPolling();
    this.pollNewOrders();
    this._pollTimer = setInterval(() => this.pollNewOrders(), 5000);
  },

  stopPolling() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  },

  async pollNewOrders() {
    try {
      const r = await api.request(`/notify/new-orders?since_id=${this._lastOrderId}`);
      if (r.latest_id < this._lastOrderId) {
        // 数据库被重置过，下调基线
        this._lastOrderId = r.latest_id || 0;
        wx.setStorageSync('lastOrderId', this._lastOrderId);
        return;
      }
      if (r.orders && r.orders.length > 0) {
        this._lastOrderId = r.latest_id;
        wx.setStorageSync('lastOrderId', this._lastOrderId);
        this.setData({ newOrders: r.orders });
        wx.vibrateLong(); // 震动提醒
        wx.showToast({ title: `${r.orders.length} 个新订单`, icon: 'none' });
      }
    } catch (e) {
      if (/登录/.test(e.message)) this.handleAuthFail();
    }
  },

  clearNewOrders() {
    this.setData({ newOrders: [] });
  },

  handleAuthFail() {
    this.stopPolling();
    wx.removeStorageSync('adminToken');
    wx.removeStorageSync('isAdmin');
    api.toast('登录已过期，请重新登录');
    setTimeout(() => wx.redirectTo({ url: '/pages/admin/login' }), 1200);
  },

  // ---------- 页面跳转 ----------
  goToOrders() {
    wx.navigateTo({ url: '/pages/admin/orders' });
  },

  goToProducts() {
    wx.navigateTo({ url: '/pages/admin/products' });
  },

  goToTables() {
    // 桌台管理直接用 Web 后台更完整；小程序内先跳顾客选桌页查看状态
    api.toast('桌台开台/结桌请用网页后台，小程序可查看桌台状态');
    wx.navigateTo({ url: '/pages/tables/tables' });
  },

  async logout() {
    try {
      await api.request('/logout', { method: 'POST' });
    } catch (_) { /* 忽略退出接口失败 */ }
    wx.removeStorageSync('adminToken');
    wx.removeStorageSync('isAdmin');
    getApp().setAdminMode(false);
    wx.reLaunch({ url: '/pages/tables/tables' });
  },
});
