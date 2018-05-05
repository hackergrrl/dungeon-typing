module.exports = GuiInventory

var vec3 = require('gl-vec3')
var mat4 = require('gl-mat4')
var Text = require('./text')
var Billboard = require('./billboard')

function GuiInventory (regl) {
  if (!(this instanceof GuiInventory)) return new GuiInventory(regl)

  this.regl = regl
  this.items = []
  this.selected = null
  this.drawBillboard = Billboard(regl)
}

GuiInventory.prototype.addItem = function (id, texture) {
  this.items.push({
    id: id,
    texture: texture,
    color: [1,1,1,1]
  })
  this.rebuild()
}

GuiInventory.prototype.selectItem = function (num) {
  this.selected = num
  this.items[num-1].y -= 8
  this.items[num-1].color = [0, 1, 0, 1]

  // TODO: deselect previous item
}

GuiInventory.prototype.rebuild = function () {
  for (var i=0; i < this.items.length; i++) {
    var item = this.items[i]
    item.drawLabel = Text(this.regl, String(i+1), item.color)
    item.x = i * 32 + 24
    item.y = 200
  }
}

GuiInventory.prototype.removeItem = function (id) {
  for (var i=0; i < this.labels.length; i++) {
    if (this.items[i].id === id) {
      this.items.splice(i, 1)
      this.rebuild()
      return true
    }
  }
  return false
}

GuiInventory.prototype.draw = function (projectionScreen, screenHeight) {
  var model = mat4.create()
  var view = mat4.create()
  var self = this
  this.items.forEach(function (item) {
    var tex = item.texture
    var at = vec3.fromValues(item.x, screenHeight - 32, -0.2)
    var scale = 25
    var model = mat4.create()

    mat4.identity(model)
    mat4.translate(model, model, at)
    mat4.scale(model, model, vec3.fromValues(scale, scale, scale))
    item.drawLabel({
      model: model,
      view: view,
      projection: projectionScreen,
    })

    at[0] += 19
    at[1] += 3
    mat4.identity(model)
    mat4.translate(model, model, at)
    mat4.scale(model, model, vec3.fromValues(scale, -scale, scale))
    var framesWide = 1
    var framesTall = 1
    var frameX = 0
    var frameY = 0
    self.drawBillboard({
      model: model,
      view: view,
      projection: projectionScreen,
      framesWide: 1 / framesWide,
      framesTall: 1 / framesTall,
      frameX: frameX / framesWide,
      frameY: frameY / framesTall,
      texture: tex.texture
    })
  })
}
