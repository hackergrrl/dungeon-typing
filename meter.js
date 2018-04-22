var mat4 = require('gl-mat4')

module.exports = function (regl, at, color) {
  var draw = regl({
    frag: `
      precision mediump float;

      uniform vec4 color;

      void main () {
        gl_FragColor = color;
      }
    `,

    vert: `
      precision mediump float;

      attribute vec2 pos;

      void main () {
        gl_Position = vec4(pos, 0.0, 1.0);
      }
    `,

    attributes: {
      pos: regl.prop('positions')
    },

    blend: {
      enable: true,
      func: {
        src: 'src alpha',
        dst: 'one minus src alpha'
      }
    },

    uniforms: {
      color: function () { return color }
    },

    elements: regl.prop('elements')
  })

  return function (segs, tick, danger) {
    var pos = []
    var elms = []
    var size = 0.015
    var y = at[1]
    var n = 0
    for (var i=0; i < segs; i++) {
      if (i % 2 === 0) {
        pos.push([at[0] - size, y])
        pos.push([at[0] + size, y + size*2])
        pos.push([at[0] + size, y - size*2])
      } else {
        pos.push([at[0] + size, y])
        pos.push([at[0] - size, y + size*2])
        pos.push([at[0] - size, y - size*2])
      }
      elms.push(n)
      elms.push(n+1)
      elms.push(n+2)
      n += 3
      y -= size * 2 + 0.005 * Math.sin(tick * (0.05 + danger * 0.3)) * (0.2 + danger)
    }
    draw({
      positions: pos,
      elements: elms
    })
  }
}
