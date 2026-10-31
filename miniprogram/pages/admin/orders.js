/**
 * 店长订单管理：查看全部订单，确认/取消待处理订单
 */
const api = require('../../utils/api.js');

const STATUS_TABS = [
  { key: 'pending', label: '待处理' },
  { key: 'confirmed', label: '已确认' },
  { key: 'settled', label: '已结账' },
  { key: 'cancelled', label: '已取消' },
];

const STATUS_TEXT = {
  pending: '待处理',
  confirmed: '已确认',
  settled: '已结账',
  cancelled: '已取消',
};

Page({
  data: {
    tabs: STATUS_TABS,
    activeTab: 'pending',
    orders: [],
    loading: true,
  },

  _timer: null,

  onLoad() {
    if (!wx.getStorageSync('isAdmin')) {
      wx.redirectTo({ url: '/pages/admin/login' });
      return;
    }
  },

  onShow() {
    this.load();
    // 每 10 秒自动刷新
    this._timer = setInterval(() => this.load(true), 10000);
  },

  onHide() { this.stopTimer(); },
  onUnload() { this.stopTimer(); },

  stopTimer() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.key });
    this.load();
  },

  async load(silent = false) {
    if (!silent) this.setData({ loading: true });
    try {
      const orders = await api.request(`/orders?status=${this.data.activeTab}&limit=100`);
      this.setData({
        orders: orders.map((o) => ({
          ...o,
          statusText: STATUS_TEXT[o.status] || o.status,
          itemsText: (o.items || []).map((it) => `${it.product_name}×${it.quantity}`).join('、'),
          timeText: (o.created_at || '').replace('T', ' ').slice(5, 16),
        })),
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
      if (/登录/.test(e.message)) {
        this.stopTimer();
        wx.removeStorageSync('adminToken');
        wx.removeStorageSync('isAdmin');
        wx.redirectTo({ url: '/pages/admin/login' });
      } else if (!silent) {
        api.toast(e.message);
      }
    }
  },

  async confirmOrder(e) {
    const { id, no } = e.currentTarget.dataset;
    const res = await wx.showModal({
      title: '确认订单',
      content: `确认订单 ${no}？确认后计入结桌账单`,
      confirmColor: '#4f46e5',
    });
    if (!res.confirm) return;
    try {
      await api.request(`/orders/${id}/confirm`, { method: 'POST' });
      api.toast('已确认', 'success');
      this.load(true);
    } catch (err) {
      api.toast(err.message);
      this.load(true);
    }
  },

  async cancelOrder(e) {
    const { id, no } = e.currentTarget.dataset;
    const res = await wx.showModal({
      title: '取消订单',
      content: `确定取消订单 ${no}？库存将自动恢复`,
      confirmColor: '#ef4444',
    });
    if (!res.confirm) return;
    try {
      await api.request(`/orders/${id}/cancel`, { method: 'POST' });
      api.toast('已取消', 'success');
      this.load(true);
    } catch (err) {
      api.toast(err.message);
      this.load(true);
    }
  },

  onPullDownRefresh() {
    this.load(true).finally(() => wx.stopPullDownRefresh());
  },
});
