/**
 * 我的订单（本桌）：状态实时刷新；桌台被结桌后退回选桌页
 */
const api = require('../../utils/api.js');
const app = getApp();

const ORDER_STATUS = {
  pending:   { text: '待店长确认', cls: 'st-pending' },
  confirmed: { text: '已确认', cls: 'st-confirmed' },
  cancelled: { text: '已取消', cls: 'st-cancelled' },
  settled:   { text: '已结账', cls: 'st-settled' },
};

Page({
  data: { orders: [], hasTable: true },

  onShow() {
    this.load();
    this._timer = setInterval(() => this.load(), 15000);
  },
  onHide() { clearInterval(this._timer); },
  onUnload() { clearInterval(this._timer); },

  async load() {
    const table = app.globalData.table;
    const savedId = Number(wx.getStorageSync('currentTableId') || 0);
    if (!table && !savedId) {
      this.setData({ hasTable: false, orders: [] });
      return;
    }
    const tableId = table ? table.id : savedId;
    try {
      const list = await api.request(`/orders?table_id=${tableId}&limit=50`);
      this.setData({
        hasTable: true,
        orders: list.map((o) => {
          const st = ORDER_STATUS[o.status] || { text: o.status, cls: '' };
          return {
            ...o,
            statusText: st.text,
            statusCls: st.cls,
            amountText: api.money(o.total_amount),
            timeText: new Date(o.created_at).toLocaleString('zh-CN',
              { hour: '2-digit', minute: '2-digit', month: '2-digit', day: '2-digit' }),
            itemsText: o.items.map((it) => `${it.product_name}×${it.quantity}`).join('　'),
          };
        }),
      });
    } catch (e) {
      api.toast(e.message);
    }
  },

  gotoTables() {
    wx.reLaunch({ url: '/pages/tables/tables' });
  },
});
