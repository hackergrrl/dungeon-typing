var mat4 = require('gl-mat4')

module.exports = function (regl) {
  return regl({
    frag: `
      precision mediump float;

      varying vec3 vPos;
      varying vec2 vUv;
      uniform sampler2D texture;

      void main () {
        vec4 tex = texture2D(texture, vUv);
        gl_FragColor = tex;
      }
    `,

    vert: `
      precision mediump float;

      uniform mat4 projection;
      uniform mat4 view;
      uniform mat4 model;
      uniform vec3 offset;
      uniform vec2 scale;
      attribute vec3 pos;
      attribute vec2 uv;
      varying vec3 vPos;
      varying vec2 vUv;

      void main () {
        // vec3 scale3 = vec3(scale, 1.0);
        gl_Position = projection * view * model * vec4(pos, 1.0);// * vec4(pos * scale3 + offset, 1.0);
        vUv = uv;
        vPos = pos;
      }
    `,

    attributes: {
      pos: [
        [ -1, +1, 0 ],
        [ +1, +1, 0 ],
        [ +1, -1, 0 ],

        [ -1, +1, 0 ],
        [ +1, -1, 0 ],
        [ -1, -1, 0 ]
      ],
      uv: [
        [ 0, 0 ],
        [ 1, 0 ],
        [ 1, 1 ],

        [ 0, 0 ],
        [ 1, 1 ],
        [ 0, 1 ]
      ]
    },

    blend: {
      enable: true,
      func: {
        src: 'src alpha',
        dst: 'one minus src alpha'
      }
    },

    uniforms: {
      projection: function (state) {
        return mat4.perspective([],
                        Math.PI / 3,
                        state.viewportWidth / state.viewportHeight,
                        0.01,
                        1000)
      },
      view: regl.prop('view'),
      model: regl.prop('model'),
      // offset: regl.prop('offset'),
      texture: regl.prop('texture'),
      // scale: regl.prop('scale')
    },

    count: 6
  })
}
