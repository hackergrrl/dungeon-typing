var mat4 = require('gl-mat4')

module.exports = function (regl) {
  var draw = regl({
    frag: `
      precision mediump float;

      varying vec4 vColor;

      void main () {
        gl_FragColor = vColor;
      }
    `,

    vert: `
      precision mediump float;

      attribute vec2 pos;
      attribute vec4 color;
      varying vec4 vColor;

      void main () {
        gl_Position = vec4(pos, 0.0, 1.0);
        vColor = color;
      }
    `,

    attributes: {
      pos: regl.prop('positions'),
      color: regl.prop('colors')
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

  return function (opts) {
    var pos = []
    var elms = []
    var col = []
    var size = 0.015
    var y = opts.at[1]
    var n = 0
    for (var i=0; i < opts.maxSegs; i++) {
      if (i % 2 === 0) {
        pos.push([opts.at[0] - size, y])
        pos.push([opts.at[0] + size, y + size*2])
        pos.push([opts.at[0] + size, y - size*2])
      } else {
        pos.push([opts.at[0] + size, y])
        pos.push([opts.at[0] - size, y + size*2])
        pos.push([opts.at[0] - size, y - size*2])
      }
      if (i < opts.segs) {
        col.push([opts.color[0], opts.color[1], opts.color[2], opts.color[3]])
        col.push([opts.color[0], opts.color[1], opts.color[2], opts.color[3]])
        col.push([opts.color[0], opts.color[1], opts.color[2], opts.color[3]])
      } else {
        col.push([opts.color[0], opts.color[1], opts.color[2], opts.color[3] * 0.1])
        col.push([opts.color[0], opts.color[1], opts.color[2], opts.color[3] * 0.1])
        col.push([opts.color[0], opts.color[1], opts.color[2], opts.color[3] * 0.1])
      }
      elms.push(n)
      elms.push(n+1)
      elms.push(n+2)
      n += 3
      y -= size * 2 + 0.005 * Math.sin(opts.tick * (0.05 + opts.danger * 0.3)) * (0.2 + opts.danger)
    }
    draw({
      positions: pos,
      colors: col,
      elements: elms
    })
  }
}
