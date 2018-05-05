var vec3 = require('gl-vec3')

module.exports = {
  vecify: vecify,
  pointLight: pointLight,
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

