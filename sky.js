var mat4 = require('gl-mat4')

module.exports = function (regl) {
  return regl({
    frag: `
      precision mediump float;

      varying vec3 vPos;

      void main () {
        vec3 sky = vec3(0.7, 142.0/255.0, 1.0);
        float intensity = 1.0 - (vPos.y * 0.002);
        gl_FragColor = vec4(sky * intensity, 1.0);
      }
    `,

    vert: `
      precision mediump float;

      uniform mat4 projection;
      attribute vec3 pos;
      varying vec3 vPos;

      void main () {
        gl_Position = projection * vec4(pos, 1.0);
        vPos = pos;
      }
    `,

    attributes: {
      pos: [
        [ -2000,+4000,-400 ],
        [  2000,    0,-400 ],
        [ -2000,-4000,-400 ]
      ]
    },

    uniforms: {
      projection: function (state) {
        return mat4.perspective([],
                        Math.PI / 3,
                        state.viewportWidth / state.viewportHeight,
                        0.01,
                        1000)
      },
    },

    count: 3
  })
}
