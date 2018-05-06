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
      attribute vec3 pos;
      attribute vec2 uv;
      varying vec3 vPos;
      varying vec2 vUv;

      void main () {
        gl_Position = projection * view * model * vec4(pos, 1.0);
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
      uv: regl.prop('uvs'),
    },

    blend: {
      enable: true,
      func: {
        src: 'src alpha',
        dst: 'one minus src alpha'
      }
    },

    uniforms: {
      projection: regl.prop('projection'),
      view: regl.prop('view'),
      model: regl.prop('model'),
      texture: regl.prop('texture'),
    },

    count: 6
  })
}
