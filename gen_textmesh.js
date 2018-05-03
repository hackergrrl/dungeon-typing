var vectorize = require('vectorize-text')

var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz1234567890'

var meshes = {}
alphabet.split('').forEach(function (letter) {
  meshes[letter] = vectorize(letter, {
    font: 'monospace',
    triangles: true,
    textAlign: 'center'
  })
})

console.log(JSON.stringify(meshes))
