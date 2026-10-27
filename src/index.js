const { MiniProgram } = require('./mini-program')
const { Page } = require('./page')
const { Element } = require('./element')
const { launch } = require('./launcher')

module.exports = {
  connect: (options) => MiniProgram.connect(options),
  launch,
  MiniProgram,
  Page,
  Element,
}
