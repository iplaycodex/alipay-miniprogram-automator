const { MiniProgram, Page, Element } = require('./src/mini-program')
const { launch } = require('./src/launcher')

module.exports = {
  connect: options => MiniProgram.connect(options),
  launch,
  MiniProgram,
  Page,
  Element
}
