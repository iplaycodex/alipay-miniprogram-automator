Page({
  data: { count: 0, message: '' },
  increment() {
    this.setData({ count: this.data.count + 1 })
  },
  onMessage(event) {
    this.setData({ message: event.detail.value })
  },
  openDetail() {
    my.navigateTo({ url: `/pages/detail/index?count=${this.data.count}` })
  },
})
