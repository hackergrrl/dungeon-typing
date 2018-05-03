var meshes = require('./textmesh.json')

module.exports = function (text) {
  var positions = []
  var cells = []

  var halfwidth = text.length * 0.5 * 0.5

  var idx = 0
  text.split('').forEach(function (letter, n) {
    var mesh = meshes[letter]
    if (!mesh) return
    for (var i = 0; i < mesh.positions.length; i++) {
      var pos = mesh.positions[i]
      positions.push([pos[0] + n * 0.5 - halfwidth, pos[1]])
    }
    for (var i = 0; i < mesh.cells.length; i++) {
      var tri = mesh.cells[i]
      cells.push([tri[0] + idx, tri[1] + idx, tri[2] + idx])
    }
    idx += mesh.positions.length
  })

  return {
    positions: positions,
    cells: cells
  }
}
