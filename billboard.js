var mat4 = require('gl-mat4')

module.exports = function (regl, framesWide, framesTall) {
  var fx = 1 / framesWide
  var fy = 1 / framesTall

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
      uniform float frameX;
      uniform float frameY;
      attribute vec3 pos;
      attribute vec2 uv;
      varying vec3 vPos;
      varying vec2 vUv;

      void main () {
        gl_Position = projection * view * model * vec4(pos, 1.0);
        vUv = vec2(uv.x + frameX, uv.y + frameY);
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
        [ 0,  0 ],
        [ fx, 0 ],
        [ fx,fy ],

        [ 0,  0 ],
        [ fx,fy ],
        [ 0, fy ]
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
      texture: regl.prop('texture'),
      frameX: regl.prop('frameX'),
      frameY: regl.prop('frameY')
    },

    count: 6
  })
}
