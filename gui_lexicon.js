module.exports = GuiLexicon

var vec3 = require('gl-vec3')
var mat4 = require('gl-mat4')
var Text = require('./text')

function GuiLexicon (regl) {
  if (!(this instanceof GuiLexicon)) return new GuiLexicon(regl)

  this.regl = regl
  this.labels = []
}

GuiLexicon.prototype.addWord = function (word, color) {
  color = color || [1,1,1,1]
  var x = 16
  var prev = this.labels[this.labels.length-1]
  if (prev) {
    var x = prev.x
    x += (prev.text.length/2) * 12 + 8
  }
  x += (word.length/2) * 12
  var draw = Text(this.regl, word, color)
  this.labels.push({
    draw: draw,
    text: word,
    scale: 0.75,
    x: x,
    y: 32
  })
}

GuiLexicon.prototype.removeWord = function (word) {
  for (var i=0; i < this.labels.length; i++) {
    if (this.labels[i].text === word) {
      this.labels.splice(i, 1)
      return true
    }
  }
  return false
}

GuiLexicon.prototype.draw = function (projectionScreen) {
  var model = mat4.create()
  var view = mat4.create()
  this.labels.forEach(function (label) {
    mat4.identity(model)
    mat4.translate(model, model, vec3.fromValues(label.x, label.y, -0.2))
    var scale = label.scale * 25
    mat4.scale(model, model, vec3.fromValues(scale, scale, scale))
    label.draw({
      projection: projectionScreen,
      view: view,
      model: model,
    })
  })
}
