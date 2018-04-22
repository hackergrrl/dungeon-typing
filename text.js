var mat4 = require('gl-mat4')
var vectorize = require('vectorize-text')
var tess = require('triangulate-polyline')

module.exports = function (regl, text) {
  var mesh = vectorize(text, {
    triangles: true,
    textAlign: 'center',
    textBaseline: 'middle'
  })

  return regl({
    frag: `
      precision mediump float;

      varying vec3 vPos;
      varying vec2 vUv;

      void main () {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
      }
    `,

    vert: `
      precision mediump float;

      uniform mat4 projection;
      uniform mat4 view;
      uniform mat4 model;
      attribute vec2 pos;

      void main () {
        gl_Position = projection * view * model * vec4(pos, 0.0, 1.0);
      }
    `,

    attributes: {
      pos: mesh.positions
    },

    uniforms: {
      projection: regl.prop('projection'),
      view: regl.prop('view'),
      model: regl.prop('model')
    },

    elements: mesh.cells,

    // depth: { enable: false }
  })
}
