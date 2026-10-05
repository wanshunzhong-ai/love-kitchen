/**
 * 空态三态块（加载 / 失败 / 空）
 *
 * 抽出来的原因：orders / todo / menu / review / dish-edit / dish-logs /
 * checkout / order-edit 八处都在手写同一套 state-emoji → state-tip →
 * state-sub → btn-retry 结构，样式还各写一遍（todo 那份已经漂移）。
 *
 * 只暴露四个属性，够覆盖现有全部用法：
 *   emoji  表情（大图标）
 *   tip    主文案
 *   sub    次要说明（可选）
 *   retry  按钮文案；留空则不出按钮（可选）
 *
 * 点击按钮只抛 `retry` 事件，具体做什么由页面决定 —— 组件不认识业务。
 */
Component({
  properties: {
    emoji: { type: String, value: '' },
    tip: { type: String, value: '' },
    sub: { type: String, value: '' },
    retry: { type: String, value: '' }
  },

  methods: {
    onRetryTap: function () {
      this.triggerEvent('retry');
    }
  }
});
