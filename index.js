var regl = require('regl')()
var mat4 = require('gl-mat4')
var key = require('key-pressed')
var pointer = require('pointer-lock')(document.body)
var Voxel = require('./voxel')
var dungeon = require('dungeon-generator')
var Sky = require('./sky')
var nano = require('nano-ecs')

var camera = {
  pos: [0, -2, -10],
  rot: [0, 0, 0]
}

var projection

var world = nano()

// gravity-affected, bounding box vs tilemap, position
function Physics () {
  this.pos = {
    x: 0,
    y: 0,
    z: 0
  }
  this.width = 8
  this.length = 8
  this.height = 8

  this.vel = {
    x: 0,
    y: 0,
    z: 0
  }
}

function CameraController () {
  this.rot = {
    x: 0,
    y: 0,
    z: 0
  }
}

pointer.on('attain', function (mv) {
  mv.on('data', function (ev) {
    camera.rot[0] += ev.dy * 0.005
    camera.rot[1] += ev.dx * 0.005
  })
})

require('resl')({
  manifest: {
    atlas: {
      type: 'image',
      src: 'atlas.png',
      parser: function (data) {
        return regl.texture({
          data: data,
          min: 'nearest',
          mag: 'nearest'
        })
      }
    }
  },

  onDone: run
})

function generateLevel (w, h) {
  var dun = new dungeon({
    size: [w, h],
    rooms: {
      any: {
        min_size: [2, 2],
        max_size: [6, 6],
        max_exits: 4
      }
    },
    max_corridor_length: 7,
    min_corridor_length: 2,
    corridor_density: 0.5,
    symmetric_rooms: false,
    interconnects: 1,
    max_interconnect_length: 10,
    room_count: 10
  })

  dun.generate()

  return dun
}

function updatePhysics (world) {
  world.queryComponents([Physics]).forEach(function (e) {
    e.physics.vel.y += 0.001

    e.physics.pos.x += e.physics.vel.x
    e.physics.pos.y += e.physics.vel.y
    e.physics.pos.z += e.physics.vel.z
  })
}

function updateCamera (world) {
  world.queryComponents([CameraController]).forEach(function (e) {
    camera.pos[0] = e.physics.pos.x
    camera.pos[1] = e.physics.pos.y
    camera.pos[2] = e.physics.pos.z
  })
}

function run (assets) {
  var accum = 0
  var frames = 0
  var last = new Date().getTime()

  var player = world.createEntity()
  player.addComponent(Physics)
  player.addComponent(CameraController)

  // alloc + config map
  var map = new Voxel(regl, 50, 10, 50, assets.atlas)
  var dun = generateLevel(25, 25)
  for (var i=0; i < map.width; i++) {
    for (var j=0; j < map.depth; j++) {
      for (var k=0; k < map.height; k++) {
        if (k >= 3 && k <= 4) {
          var x = Math.floor(i / 2)
          var y = Math.floor(j / 2)
          map.set(i, k, j, dun.walls.get([x, y]) ? 1 : 0)
        } else {
          map.set(i, k, j, 1)
        }
      }
    }
  }

  map.generateGeometry()

  camera.pos[0] = -35 * 2
  camera.pos[2] = -35 * 2

  var view = mat4.lookAt([],
                        [0, 0, -30],
                        [0, 0.0, 0],
                        [0, 1, 0])

  var sky = Sky(regl)

  regl.frame(function (state) {
    accum += (new Date().getTime() - last)
    frames++
    if (accum >= 1000) {
      console.log(''+frames, 'FPS')
      frames = 0
      accum = 0
    }
    last = new Date().getTime()

    updatePhysics(world)
    updateCamera(world)

    projection = mat4.perspective([],
                                  Math.PI / 3,
                                  state.viewportWidth / state.viewportHeight,
                                  0.01,
                                  1000)

    mat4.identity(view)
    mat4.rotateX(view, view, camera.rot[0])
    mat4.rotateY(view, view, camera.rot[1])
    mat4.rotateZ(view, view, camera.rot[2])
    mat4.translate(view, view, camera.pos)

    if (key('W')) {
      camera.pos[2] += Math.cos(camera.rot[1])
      camera.pos[0] -= Math.sin(camera.rot[1])
      camera.pos[1] += Math.sin(camera.rot[0])
    }
    if (key('S')) {
      camera.pos[2] += Math.cos(camera.rot[1]) * -1
      camera.pos[0] -= Math.sin(camera.rot[1]) * -1
      camera.pos[1] += Math.sin(camera.rot[0]) * -1
    }
    if (key('D')) {
      camera.pos[2] += Math.cos(camera.rot[1] + Math.PI/2)
      camera.pos[0] -= Math.sin(camera.rot[1] + Math.PI/2)
    }
    if (key('A')) {
      camera.pos[2] -= Math.cos(camera.rot[1] + Math.PI/2)
      camera.pos[0] += Math.sin(camera.rot[1] + Math.PI/2)
    }

    regl.clear({
      color: [0, 0, 0, 1],
      depth: 1
    })

    sky()

    map.draw({
      projection: projection,
      view: view
    })
  })
}
