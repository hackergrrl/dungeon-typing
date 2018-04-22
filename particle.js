module.exports = function (regl) {
  return regl({
    frag: `
      precision mediump float;

      uniform vec4 color;

      void main () {
        gl_FragColor = color;
      }
    `,

    vert: `
      precision mediump float;

      uniform mat4 projection;
      uniform mat4 view;
      uniform mat4 model;
      attribute vec3 pos;

      void main () {
        gl_Position = projection * view * model * vec4(pos, 1.0);
      }
    `,

    attributes: {
      pos: [
        [  0, +1, 0 ],
        [ +1, -1, 0 ],
        [ -1, -1, 0 ]
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
      projection: regl.prop('projection'),
      view: regl.prop('view'),
      model: regl.prop('model'),
      color: regl.prop('color')
    },

    count: 3
  })
}
