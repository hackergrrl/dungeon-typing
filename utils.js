var vec3 = require('gl-vec3')

module.exports = {
  vecify: vecify,
  pointLight: pointLight,
  rollDice: rollDice,
  physicsDistance: physicsDistance,
  xyzDistance: xyzDistance,
  distCmp: distCmp,
}

function vecify (v) {
  return vec3.fromValues(v.x, v.y, v.z)
}

function pointLight (lpos, lightIntensity, vpos, normal) {
  var out = vec3.create()
  var dir = vec3.sub(out, vpos, lpos)
  var dist = vec3.length(out)
  return Math.min(2.0, Math.max(0, lightIntensity / (dist*dist)))
}

function rollDice (str) {
  var rolls = Number(str.split('d')[0])
  var sides = Number(str.split('+')[0].split('d')[1])
  var add = Number(str.split('+')[1])

  var res = add
  for (var i=0; i < rolls; i++) {
    res += Math.floor(Math.random() * sides) + 1
  }

  return res
}

function physicsDistance (a, b) {
  var dx = b.physics.pos.x - a.physics.pos.x
  var dy = b.physics.pos.y - a.physics.pos.y
  var dz = b.physics.pos.z - a.physics.pos.z
  return Math.sqrt(dx*dx + dy*dy + dz*dz)
}

function xyzDistance (a, x, y, z) {
  var dx = x - a.physics.pos.x
  var dy = y - a.physics.pos.y
  var dz = z - a.physics.pos.z
  return Math.sqrt(dx*dx + dy*dy + dz*dz)
}

function distCmp (plr, a, b) {
  var aDist = physicsDistance(plr, a)
  var bDist = physicsDistance(plr, b)
  return bDist - aDist
}
