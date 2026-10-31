/**
 * 选桌 / 自助开台（对应网页端 mobile 的选桌页 + 开台确认弹层）
 */
const api = require('../../utils/api.js');
const app = getApp();

// 与后端 server/routes/tables.js 的 ROOM_TYPES 保持一致
const ROOM_TYPES = { standard: '标准间', deluxe: '豪华间', vip: 'VIP包间' };

Page({
  data: {
    tables: [],
    openInfo: null,   // 非空时显示开台确认弹层
    cname: '',
  },

  onLoad(options) {
    // 扫码进入：小程序码自定义 scene 在页面 onLoad 里（需 decode），
    // 支持 scene=A1 或 scene=table=A1 两种写法；普通启动参数 table/id 同义
    let name = options.table || options.id || '';
    if (!name && options.scene) {
      const scene = decodeURIComponent(options.scene);
      const m = scene.match(/(?:^|&)table=([^&]+)/);
      name = m ? m[1] : scene;
    }
    if (!name) name = app.globalData.sceneTable;
    // 场景值编号（如 1047）是纯数字，绝不是桌台名，防止误当成桌台查询
    if (name && /^\d+$/.test(name)) name = '';
    if (name) {
      this._pendingName = name;
      app.globalData.sceneTable = '';
    }
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const tables = await api.request('/tables');
      this.setData({
        tables: tables.map((t) => ({
          ...t,
          rateText: api.money(t.hourly_rate),
          occupied: t.status === 'occupied',
        })),
      });
      if (this._pendingName) {
        const name = this._pendingName;
        this._pendingName = null;
        const t = tables.find((x) => x.name.toLowerCase() === name.toLowerCase());
        if (t) return t.status === 'occupied' ? this.enter(t) : this.showOpen(t);
        api.toast(`未找到桌台「${name}」，请手动选择`);
      }
    } catch (e) {
      api.toast(e.message);
    }
  },

  pickTable(e) {
    const id = Number(e.currentTarget.dataset.id);
    const t = this.data.tables.find((x) => x.id === id);
    if (!t) return;
    if (t.occupied) return this.enter(t);
    this.showOpen(t);
  },

  // 开台确认弹层（与网页端同款：费率/低消/计费提醒/称呼）
  showOpen(t) {
    this.setData({
      cname: '',
      openInfo: {
        id: t.id,
        name: t.name,
        roomTypeText: ROOM_TYPES[t.room_type] || t.room_type,
        rateText: api.money(t.hourly_rate),
        minText: t.min_hours + ' 小时',
      },
    });
  },
  closeOpen() { this.setData({ openInfo: null }); },
  noop() {}, // 阻止弹层内点击冒泡到遮罩
  onCnameInput(e) { this.setData({ cname: e.detail.value }); },

  async confirmOpen() {
    const info = this.data.openInfo;
    if (!info) return;
    try {
      const opened = await api.request(`/tables/${info.id}/open`, {
        method: 'POST',
        body: { customer_name: this.data.cname.trim() || '自助开台' },
      });
      this.setData({ openInfo: null });
      api.toast('开台成功，开始计费', 'success');
      this.enter(opened);
    } catch (e) {
      api.toast(e.message);
      this.load();
    }
  },

  enter(t) {
    app.setTable(t);
    wx.switchTab({ url: '/pages/shop/shop' });
  },

  // 店长入口：已登录直接进管理页，否则进登录页
  enterAdmin() {
    if (wx.getStorageSync('isAdmin') && wx.getStorageSync('adminToken')) {
      wx.navigateTo({ url: '/pages/admin/manager' });
    } else {
      wx.navigateTo({ url: '/pages/admin/login' });
    }
  },
});
