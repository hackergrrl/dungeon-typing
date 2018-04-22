var regl = require('regl')()
var mat4 = require('gl-mat4')
var key = require('key-pressed')
var pointer = require('pointer-lock')(document.body)
var Voxel = require('./voxel')
var dungeon = require('dungeon-generator')
var Sky = require('./sky')
var nano = require('nano-ecs')
var vec3 = require('gl-vec3')
var Billboard = require('./billboard')

var camera = {
  pos: [0, -2, -10],
  rot: [0, 0, 0]
}

var systems = [
  updatePhysics,
  updateCamera,
  updateMobAI
]

var projection

var world = nano()
var map

function pointLight (lpos, lightIntensity, vpos, normal) {
  var out = vec3.create()
  var dir = vec3.sub(out, vpos, lpos)
  var dist = vec3.length(out)
  return Math.min(2.0, Math.max(0, lightIntensity / (dist*dist)))
}

// gravity-affected, bounding box vs tilemap, position
function Physics () {
  this.pos = {
    x: 0,
    y: 0,
    z: 0
  }
  this.width = 4
  this.length = 4
  this.height = 4

  this.vel = {
    x: 0,
    y: 0,
    z: 0
  }
}

function MobAI () {
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
    },
    foe: {
      type: 'image',
      src: 'assets/foe.png',
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
      initial: {
        min_size: [3, 3],
        max_size: [3, 3],
        max_exits: 1,
        position: [0, 0]
      },
      any: {
        min_size: [5, 5],
        max_size: [8, 8],
        max_exits: 4
      }
    },
    max_corridor_length: 7,
    min_corridor_length: 2,
    corridor_density: 0.5,
    symmetric_rooms: false,
    interconnects: 1,
    max_interconnect_length: 10,
    room_count: 6
  })

  dun.generate()

  return dun
}

function isSolid (x, z) {
  x /= 2
  z /= 2
  z += 0.5
  x += 0.5
  if (x <= 0 || z <= 0 || x >= map.width || z >= map.depth) {
    return true
  }
  return !!map.get(Math.floor(x), 1, Math.floor(z))
}

function updateMobAI (world) {
  world.queryComponents([MobAI, Physics]).forEach(function (e) {
    var plr = world.queryTag('player')[0]
    var dx = plr.physics.pos.x - e.physics.pos.x
    var dz = plr.physics.pos.z - e.physics.pos.z
    var dist = Math.sqrt(dx*dx + dz*dz)
    dx /= dist
    dz /= dist
    e.physics.vel.x += dx * 0.001
    e.physics.vel.z += dz * 0.001
  })
}

function updatePhysics (world) {
  world.queryComponents([Physics]).forEach(function (e) {
    // gravity
    e.physics.vel.y -= 0.006

    // wall collisions; test x and z separately
    var tx = e.physics.pos.x + e.physics.vel.x
    if (isSolid(tx, e.physics.pos.z)) {
      e.physics.vel.x = 0
    }
    var tz = e.physics.pos.z + e.physics.vel.z
    if (isSolid(e.physics.pos.x, tz)) {
      e.physics.vel.z = 0
    }

    // newtonian physics
    e.physics.pos.x += e.physics.vel.x
    e.physics.pos.y += e.physics.vel.y
    e.physics.pos.z += e.physics.vel.z

    // ground friction
    e.physics.vel.x *= 0.94
    e.physics.vel.z *= 0.94

    // ground collision
    if (e.physics.pos.y <= 1 + e.physics.height/2) {
      e.physics.vel.y *= -0.3
      e.physics.pos.y = 1 + e.physics.height/2
    }
  })
}

function updateCamera (world) {
  world.queryComponents([CameraController]).forEach(function (e) {
    camera.pos[0] = -e.physics.pos.x
    camera.pos[1] = -e.physics.pos.y
    camera.pos[2] = -e.physics.pos.z

    if (key('W')) {
      e.physics.vel.z -= Math.cos(camera.rot[1]) * 0.01
      e.physics.vel.x += Math.sin(camera.rot[1]) * 0.01
    }
    if (key('S')) {
      e.physics.vel.z += Math.cos(camera.rot[1]) * 0.01
      e.physics.vel.x -= Math.sin(camera.rot[1]) * 0.01
    }
    if (key('D')) {
      e.physics.vel.z -= Math.cos(camera.rot[1] + Math.PI/2) * 0.01
      e.physics.vel.x += Math.sin(camera.rot[1] + Math.PI/2) * 0.01
    }
    if (key('A')) {
      e.physics.vel.z -= Math.cos(camera.rot[1] - Math.PI/2) * 0.01
      e.physics.vel.x += Math.sin(camera.rot[1] - Math.PI/2) * 0.01
    }
  })
}

function run (assets) {
  var accum = 0
  var frames = 0
  var last = new Date().getTime()

  var player = world.createEntity()
  player.addComponent(Physics)
  player.addComponent(CameraController)
  player.addTag('player')

  var foe = world.createEntity()
  foe.addComponent(Physics)
  foe.addComponent(MobAI)
  foe.physics.height = 3
  foe.physics.pos.x = 12
  foe.physics.pos.z = 12
  foe.physics.pos.y = 5

  // alloc + config map
  map = new Voxel(regl, 50, 10, 50, assets.atlas)
  var dun = generateLevel(25, 25)
  for (var i=0; i < map.width; i++) {
    for (var j=0; j < map.depth; j++) {
      for (var k=0; k < map.height; k++) {
        if (k >= 1 && k <= 2) {
          var x = Math.floor(i / 2)
          var y = Math.floor(j / 2)
          map.set(i, k, j, dun.walls.get([x, y]) ? 1 : 0)
        } else {
          map.set(i, k, j, 1)
        }
      }
    }
  }

  // var p = dun.children[Math.floor(Math.random() * dun.children.length)]
  // player.physics.pos.x = (p.position[0] + p.room_size[0]/2) * 2 + 0.5
  // player.physics.pos.z = (p.position[1] + p.room_size[1]/2) * 2 + 0.5
  var room = dun.initial_room
  player.physics.pos.x = (room.position[0] + room.size[0]) * 2
  player.physics.pos.z = (room.position[1] + room.size[1]) * 2
  player.physics.pos.y = 4
  camera.rot[1] = -Math.PI
  // console.log(p.position, p.size)

  map.generateGeometry()

  // default darkness
  for (var i=0; i < map.width; i++) {
    for (var j=0; j < map.depth; j++) {
      for (var k=0; k < map.height; k++) {
        map.lightBoxSet(i, k, j, function (pos, normal) {
          return [0.1, 0.1, 0.1]
        })
      }
    }
  }

  function updateLights (lights) {
    for (var i=0; i < map.width; i++) {
      for (var j=0; j < map.depth; j++) {
        for (var k=0; k < map.height; k++) {
          lights.forEach(function (light) {
            var lightPos = vec3.fromValues(light.pos.x, light.pos.y, light.pos.z)
            map.lightBoxAdd(i, k, j, function (pos, normal) {
              var br = pointLight(lightPos, light.intensity, pos, normal)
              return [br * 226/255, br * 188/255, br * 134/255]
            })
          })
        }
      }
    }
  }

  var view = mat4.lookAt([],
                        [0, 0, -30],
                        [0, 0.0, 0],
                        [0, 1, 0])

  var sky = Sky(regl)

  var chr = Billboard(regl, 2)

  function drawBillboard (state, x, y, z, texture) {
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, vec3.fromValues(x, y, z))
    mat4.scale(model, model, vec3.fromValues(1.5, 1.5, 1.5))
    var rot = -Math.atan2(-camera.pos[2] - x, -camera.pos[0] - z) + Math.PI/2
    mat4.rotateY(model, model, rot)
    chr({
      model: model,
      frame: state.tick % 70 < 35 ? 0 : 0.5,
      view: view,
      texture: texture
    })
  }

  console.time('light')
  var lights = []
  dun.children.forEach(function (p) {
    lights.push({
      pos: {
        x: (p.position[0] + p.room_size[0]/2) * 2,
        y: 3,
        z: (p.position[1] + p.room_size[1]/2) * 2
      },
      intensity: Math.random() * 5 + 4
    })
  })
  updateLights(lights)
  console.timeEnd('light')

  regl.frame(function (state) {
    accum += (new Date().getTime() - last)
    frames++
    if (accum >= 1000) {
      console.log(''+frames, 'FPS')
      frames = 0
      accum = 0
    }
    last = new Date().getTime()

    systems.forEach(function (s) { s(world) })

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

    regl.clear({
      color: [0, 0, 0, 1],
      depth: 1
    })

    sky()

    map.draw({
      projection: projection,
      view: view
    })

    world.queryComponents([MobAI, Physics]).forEach(function (e) {
      drawBillboard(state, e.physics.pos.x, e.physics.pos.y, e.physics.pos.z, assets.foe)
    })
  })
}
