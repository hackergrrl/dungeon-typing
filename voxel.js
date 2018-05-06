var mat4 = require('gl-mat4')
var vec3 = require('gl-vec3')

module.exports = Voxel

var Side = {
  Front: 0,
  Back:  1,
  Top:   2,
  Bottom:3,
  Left:  4,
  Right: 5
}

var boxVertices = [
  [ -1, +1, +1 ], [ +1, +1, +1 ], [ +1, -1, +1 ], [ -1, -1, +1 ],  // front
  [ -1, +1, -1 ], [ +1, +1, -1 ], [ +1, -1, -1 ], [ -1, -1, -1 ],  // back
  [ -1, +1, +1 ], [ -1, +1, -1 ], [ +1, +1, -1 ], [ +1, +1, +1 ],  // top
  [ -1, -1, +1 ], [ -1, -1, -1 ], [ +1, -1, -1 ], [ +1, -1, +1 ],  // bottom
  [ -1, -1, +1 ], [ -1, -1, -1 ], [ -1, +1, -1 ], [ -1, +1, +1 ],  // left
  [ +1, -1, +1 ], [ +1, -1, -1 ], [ +1, +1, -1 ], [ +1, +1, +1 ],  // right
]

var boxUv = [
  [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ],  // front
  [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ],  // back
  [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ],  // top
  [ 0, 0 ], [ 1, 0 ], [ 1, 1 ], [ 0, 1 ],  // bottom
  [ 0, 1 ], [ 1, 1 ], [ 1, 0 ], [ 0, 0 ],  // left
  [ 0, 1 ], [ 1, 1 ], [ 1, 0 ], [ 0, 0 ],  // right
]

var boxNormal = [
  [ 0, 0, 1 ], [ 0, 0, 1 ], [ 0, 0, 1 ], [ 0, 0, 1 ],  // front
  [ 0, 0,-1 ], [ 0, 0,-1 ], [ 0, 0,-1 ], [ 0, 0,-1 ],  // back
  [ 0, 1, 0 ], [ 0, 1, 0 ], [ 0, 1, 0 ], [ 0, 1, 0 ],  // top
  [ 0,-1, 0 ], [ 0,-1, 0 ], [ 0,-1, 0 ], [ 0,-1, 0 ],  // bottom
  [-1, 0, 0 ], [-1, 0, 0 ], [-1, 0, 0 ], [-1, 0, 0 ],  // left
  [ 1, 0, 0 ], [ 1, 0, 0 ], [ 1, 0, 0 ], [ 1, 0, 0 ]   // right
]

var boxElements = [
  [ 0, 1, 2 ], [ 0, 2, 3 ],  // front
  [ 4, 5, 6 ], [ 4, 6, 7 ],  // back
  [ 8, 9,10 ], [ 8,10,11 ],  // top
  [12,13,14 ], [12,14,15 ],  // bottom
  [16,17,18 ], [16,18,19 ],  // left
  [20,21,22 ], [20,22,23 ],  // right
]

function makeReglElement (regl) {
  return regl({
    frag: `
      precision mediump float;

      varying vec2 vUV;
      varying vec3 vNormal;
      varying vec3 vColor;
      uniform sampler2D texture;

      void main () {
        vec3 sun = normalize(vec3(-0.3, +0.5, 0.4));
        float br = clamp(dot(sun, vNormal) + 1.2, 0.0, 1.0);

        vec3 tex = texture2D(texture, vUV).xyz * vColor;
        vec4 res = vec4(tex.x * br, tex.y * br, tex.z * br, 1.0);
        gl_FragColor = res;
      }
    `,

    vert: `
      precision mediump float;

      uniform mat4 projection;
      uniform mat4 view;
      attribute vec3 pos;
      attribute vec2 uv;
      attribute vec3 normal;
      attribute vec3 color;

      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec2 vUV;

      void main () {
        gl_Position = projection * view * vec4(pos, 1.0);
        vUV = uv;
        vNormal = normal;
        vColor = color;
      }
    `,

    elements: regl.prop('elements'),

    attributes: {
      pos: regl.prop('positions'),
      uv: regl.prop('uvs'),
      normal: regl.prop('normals'),
      color: regl.prop('colors')
    },

    uniforms: {
      view: regl.prop('view'),
      projection: regl.prop('projection'),
      texture: regl.prop('texture')
    },

  //   cull: {
  //     enable: true,
  //     face: 'back'
  //   }
  })
}

function Voxel (regl, width, height, depth, atlas, tileTextureWidth, tileTextureHeight) {
  this.position = []
  this.uv = []
  this.normal = []
  this.color = []
  this.elements = []
  this.index = 0

  this.offsets = allocMap(width, height, depth)

  this.width = width
  this.height = height
  this.depth = depth

  this.atlasTexture = atlas
  this.atlasWidth = atlas.width
  this.atlasHeight = atlas.height
  this.tileWidth = tileTextureWidth
  this.tileHeight = tileTextureHeight
  this.map = allocMap(width, height, depth)

  this.tileDefs = {}

  this.drawCmd = makeReglElement(regl)
}

Voxel.prototype.defineTile = function (name, topUv, sideUv, bottomUv) {
  this.tileDefs[name] = {
    top: topUv,
    side: sideUv,
    bottom: bottomUv
  }
}

Voxel.prototype.set = function (x, y, z, value) {
  this.map[x][y][z] = value
}

Voxel.prototype.setColor = function (x, y, z, side, vert, color) {
  var n = this.offsets[x][y][z][side * 4 + vert]
  if (n) {
    this.color[n] = color
  }
}

Voxel.prototype.addColor = function (x, y, z, side, vert, color) {
  var n = this.offsets[x][y][z][side * 4 + vert]
  if (n) {
    this.color[n][0] += color[0]
    this.color[n][1] += color[1]
    this.color[n][2] += color[2]
  }
}

Voxel.prototype.get = function (x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x >= this.width || y >= this.height || z >= this.depth) return
  return this.map[x][y][z]
}

Voxel.prototype.lightBoxSet = function (x, y, z, fn) {
  // 6 sides
  for (var i=0; i < 6; i++) {
    var normal = sideToNormal(i)

    // 4 vertices
    for (var j=0; j < 4; j++) {
      var offset = sideVertToPos(i, j)
      var pos = vec3.fromValues(x + offset[0], y + offset[1], z + offset[2])
      var res = fn(pos, normal)
      if (res) this.setColor(x, y, z, i, j, res)
    }
  }
}

Voxel.prototype.lightBoxAdd = function (x, y, z, fn) {
  // 6 sides
  for (var i=0; i < 6; i++) {
    var normal = sideToNormal(i)

    // 4 vertices
    for (var j=0; j < 4; j++) {
      var offset = sideVertToPos(i, j)
      var pos = vec3.fromValues(x + offset[0], y + offset[1], z + offset[2])
      var res = fn(pos, normal)
      if (res) this.addColor(x, y, z, i, j, res)
    }
  }
}

Voxel.prototype.generateGeometry = function () {
  // map -> geometry
  for (var i=0; i < this.width; i++) {
    for (var j=0; j < this.height; j++) {
      for (var k=0; k < this.depth; k++) {
        var tile = this.map[i][j][k]
        if (tile) this.addBox(i, j, k, tile)
      }
    }
  }
  console.log('faces', this.elements.length / 2)
}

Voxel.prototype.draw = function (opts) {
  if (!opts) opts = {}
  opts.texture = this.atlasTexture.data,
  opts.elements = this.elements,
  opts.positions = this.position,
  opts.uvs = this.uv,
  opts.normals = this.normal
  opts.colors = this.color
  this.drawCmd(opts)
}

function allocMap (width, height, depth) {
  var columns = new Array(width).fill()
  columns.forEach(function (_, n) {
    columns[n] = new Array(height).fill()
    columns[n].forEach(function (_, m) {
      columns[n][m] = new Array(depth).fill(0)
    })
  })

  columns.width = width
  columns.height = height
  columns.depth = depth

  return columns
}

Voxel.prototype.isSolid = function (x, y, z) {
  if (x < 0 || x >= this.map.width) return true
  if (y < 0) return true
  if (y >= this.map.height) return true
  if (z < 0 || z >= this.map.depth) return true

  return !!this.map[x][y][z]
}

Voxel.prototype.addBox = function (x, y, z, tileDefName) {
  // visibility of each of the 6 sides of the box
  var visible = new Array(6).fill()
  visible[Side.Top]    = !this.isSolid(x, y + 1, z)
  visible[Side.Bottom] = !this.isSolid(x, y - 1, z)
  visible[Side.Front]  = !this.isSolid(x, y, z + 1)
  visible[Side.Back]   = !this.isSolid(x, y, z - 1)
  visible[Side.Left]   = !this.isSolid(x - 1, y, z)
  visible[Side.Right]  = !this.isSolid(x + 1, y, z)
  var numSides = visible.reduce(function (sum, s) { return sum + (s ? 1 : 0) }, 0)

  x *= 2
  y *= 2
  z *= 2

  var skips = 0

  var tx = Math.floor(x/2)
  var ty = Math.floor(y/2)
  var tz = Math.floor(z/2)
  this.offsets[tx][ty][tz] = new Array(6).fill(null)

  // vertices, uv, normals, colors
  for (var i = 0; i < boxVertices.length; i++) {
    this.offsets[tx][ty][tz][i] = null

    var side = Math.floor(i / 4)
    if (!visible[side]) {
      skips++
      continue
    }

    // vertices
    this.position.push([boxVertices[i][0] + x,
                        boxVertices[i][1] + y,
                        boxVertices[i][2] + z])

    // texture coords
    var frame
    if (side === Side.Top) frame = this.tileDefs[tileDefName].top
    else if (side === Side.Bottom) frame = this.tileDefs[tileDefName].bottom
    else frame = this.tileDefs[tileDefName].side
    var framesAcross = this.atlasWidth / this.tileWidth
    var framesDown = this.atlasHeight / this.tileHeight
    var oneFrameX = this.tileWidth / this.atlasWidth
    var oneFrameY = this.tileHeight / this.atlasHeight
    this.uv.push([boxUv[i][0] / framesAcross + (frame[0] * oneFrameX),
                  boxUv[i][1] / framesDown + (frame[1] * oneFrameY)])

    // normals
    this.normal.push([boxNormal[i][0], boxNormal[i][1], boxNormal[i][2]])

    // colors
    this.color.push([1,1,1])
    this.offsets[tx][ty][tz][i] = this.color.length - 1

    // element
    if (i % 4 === 0) {
      var n = i / 4
      this.elements.push([boxElements[n*2][0] + this.index - skips,
                          boxElements[n*2][1] + this.index - skips,
                          boxElements[n*2][2] + this.index - skips])
      this.elements.push([boxElements[n*2+1][0] + this.index - skips,
                          boxElements[n*2+1][1] + this.index - skips,
                          boxElements[n*2+1][2] + this.index - skips])
    }
  }

  this.index += numSides * 4
}

function sideToNormal (side) {
  switch (side) {
    case 0: return vec3.fromValues( 0, 0, 1)
    case 1: return vec3.fromValues( 0, 0,-1)
    case 2: return vec3.fromValues( 0, 1, 1)
    case 3: return vec3.fromValues( 0,-1, 1)
    case 4: return vec3.fromValues(-1, 0, 1)
    case 5: return vec3.fromValues( 1, 0, 1)
  }
}

var lightVerts = boxVertices
  .map(function (v) { return [v[0]/2, v[1]/2, v[2]/2] })
function sideVertToPos (side, vert) {
  return lightVerts[side * 4 + vert]
}
