var regl = require('regl')()
var mat4 = require('gl-mat4')
var key = require('key-pressed')
var Voxel = require('./voxel')
var dungeon = require('dungeon-generator')
var Sky = require('./sky')
var nano = require('nano-ecs')
var vec3 = require('gl-vec3')
var Billboard = require('./billboard')
var Text = require('./text')
var Particle = require('./particle')

var camera = {
  pos: [0, -2, -10],
  rot: [0, 0, 0],
  shake: [0, 0, 0],
  shakeVel: [0, 0, 0]
}

var lexicon = {
  'hit': hitCommand
}

var letters = 0
var lastLetter = 0

var systems = [
  updatePhysics,
  updateCamera,
  updateMobAI,
  updateParticles
]

var projection

var world = nano()
var map

function vecify (v) {
  return vec3.fromValues(v.x, v.y, v.z)
}

function pointLight (lpos, lightIntensity, vpos, normal) {
  var out = vec3.create()
  var dir = vec3.sub(out, vpos, lpos)
  var dist = vec3.length(out)
  return Math.min(2.0, Math.max(0, lightIntensity / (dist*dist)))
}

function spawnParticleStrike (at) {
  var parts = world.createEntity()
  parts.addComponent(ParticleEffect)
  parts.particleEffect.init({
    count: 10,
    pos: at,
    speed: 0.08,
    fadeRate: 0.02,
    color: [1, 1, 1, 1]
  })
}

function spawnParticleBlood (at) {
  var parts = world.createEntity()
  parts.addComponent(ParticleEffect)
  at = vec3.clone(at)
  at[1] += 1.0
  parts.particleEffect.init({
    count: 20,
    pos: at,
    speed: 0.025,
    fadeRate: 0.01,
    color: [1, 0, 0, 1]
  })
}

function spawnParticleHit (at) {
  var parts = world.createEntity()
  parts.addComponent(ParticleEffect)
  parts.particleEffect.init({
    count: 7,
    pos: at,
    speed: 0.05,
    color: [0.7, 0.7, 0.7, 1.0]
  })
}

function checkLexicon (plr, mob, text) {
  var words = Object.keys(lexicon)

  for (var j=0; j < words.length; j++) {
    var word = words[j]
    if (word == text) return lexicon[text]
    if (word.startsWith(text)) return true
  }
  return false
}

function hitCommand (plr, target) {
  camera.shakeVel[0] = Math.sin(camera.rot[1]) * 0.5
  camera.shakeVel[1] = 0
  camera.shakeVel[2] = -Math.cos(camera.rot[1]) * 0.5

  var dist = physicsDistance(plr, target)
  if (dist <= 4) {
    target.physics.vel.x += Math.sin(camera.rot[1]) * 0.1
    target.physics.vel.z += -Math.cos(camera.rot[1]) * 0.1
    spawnParticleStrike(vecify(target.physics.pos))
    target.health.damage(7)
  }
}

function physicsDistance (a, b) {
  var dx = b.physics.pos.x - a.physics.pos.x
  var dy = b.physics.pos.y - a.physics.pos.y
  var dz = b.physics.pos.z - a.physics.pos.z
  return Math.sqrt(dx*dx + dy*dy + dz*dz)
}

function xyzDistance (a, x, y, z) {
  var dx = x - a.physics.pos.x
  var dy = y - a.physics.pos.y
  var dz = z - a.physics.pos.z
  return Math.sqrt(dx*dx + dy*dy + dz*dz)
}

function getObjectAt (x, y, z, radius) {
  var match
  world.queryComponents([Physics]).forEach(function (e) {
    var dist = xyzDistance(e, x, y, z)
    if (dist <= radius) {
      match = e
    }
  })
  return match
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

  this.friction = 0.94

  this.vel = {
    x: 0,
    y: 0,
    z: 0
  }
}

function MobAI (e) {
  e.on('damage', function (amount) {
    console.log('ow, I have', e.health.amount, 'hp left')

    var txt = world.createEntity()
    txt.addComponent(Text3D)
    txt.addComponent(Physics)
    txt.text3D.generate(''+amount, [0.8, 0.1, 0.1, 1.0])
    txt.physics.pos = JSON.parse(JSON.stringify(e.physics.pos))
    txt.physics.pos.y = 2.5
    txt.physics.vel.y = 0.15
    txt.physics.vel.x = (Math.random() - 0.5) * 0.05
    txt.physics.vel.z = (Math.random() - 0.5) * 0.05
    txt.physics.vel.x += Math.sin(camera.rot[1]) * 0.05
    txt.physics.vel.z -= Math.cos(camera.rot[1]) * 0.05
    txt.physics.height = 0.8
    txt.physics.width = 0.2
    txt.physics.depth = 0.2
    txt.physics.friction = 0.3
  })
  e.on('death', function () {
    // spawnParticleBlood(vec3.fromValues(e.physics.pos.x, e.physics.pos.y, e.physics.pos.z))
    e.remove()
  })
}

function Health (e) {
  this.amount = 100
  this.max = 100

  this.init = function (max) {
    this.amount = this.max = max
  }

  this.damage = function (num) {
    if (this.amount <= 0) return

    this.amount -= num
    e.emit('damage', num)
    if (this.amount <= 0) {
      e.emit('death')
    }
  }
}

function CameraController () {
  this.rot = {
    x: 0,
    y: 0,
    z: 0
  }
}

function ParticleEffect () {
  this.data = null
  this.draw = Particle(regl)
  this.color = null

  this.init = function (opts) {
    this.color = opts.color
    this.fadeRate = opts.fadeRate || 0.03
    this.data = new Array(opts.count)
      .fill()
      .map(function () {
        var vel = vec3.random(vec3.create(), opts.speed)
        vec3.add(vel, vel, vec3.fromValues(0, 0.03, 0))
        return {
          pos: vec3.clone(opts.pos),
          vel: vel,
          scale: 0.1,
          mat: mat4.create()
        }
      })
  }
}

function TextProjectile () {
}

function Text3D () {
  this.generate = function (string, color) {
    this.draw = Text(regl, string, color || undefined)
    this.text = string
  }

  this.x = this.y = this.z = 0
  this.draw = undefined
  this.expireTime = new Date().getTime() + 1500
}

function TextHolder () {
  this.draw = undefined
  this.text = ''
  this.alpha = 1.0
  this.add = function (letter) {
    this.text += letter
    this.draw = Text(regl, this.text)
  }
  this.clear = function () {
    this.text = ''
    this.draw = undefined
    this.fade = false
    this.alpha = 1.0
    this.locked = false
  }
  this.setColor = function (col) {
    this.draw = Text(regl, this.text, col)
  }
  this.fadeOut = function () {
    this.fade = true
  }
  this.update = function () {
    if (this.fade && this.draw) {
      this.draw.color = [
        this.draw.color[0],
        this.draw.color[1],
        this.draw.color[2],
        this.alpha
      ]
      this.alpha -= 0.05
    }
  }
}

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
    if (dist > 3) {
      dx /= dist
      dz /= dist
      e.physics.vel.x += dx * 0.002
      e.physics.vel.z += dz * 0.002
    }
  })
}

function updatePhysics (world) {
  world.queryComponents([Physics]).forEach(function (e) {
    // gravity
    e.physics.vel.y -= 0.006

    // wall collisions; test x and z separately
    var tx = e.physics.pos.x + e.physics.vel.x
    if (isSolid(tx, e.physics.pos.z)) {
      e.physics.vel.x *= -0.3
    }
    var tz = e.physics.pos.z + e.physics.vel.z
    if (isSolid(e.physics.pos.x, tz)) {
      e.physics.vel.z *= -0.3
    }

    // newtonian physics
    e.physics.pos.x += e.physics.vel.x
    e.physics.pos.y += e.physics.vel.y
    e.physics.pos.z += e.physics.vel.z

    // ground collision
    var onGround = false
    if (e.physics.pos.y - e.physics.height/2 <= 1) {
      e.physics.vel.y *= -0.3
      e.physics.pos.y = 1 + e.physics.height/2
      onGround = true
    }

    // ceiling collision
    if (e.physics.pos.y >= 5) {
      e.physics.vel.y *= -0.3
      e.physics.pos.y = 5
    }

    // ground friction
    if (onGround) {
      e.physics.vel.x *= e.physics.friction
      e.physics.vel.z *= e.physics.friction
    }
  })
}

function updateCamera (world) {
  world.queryComponents([CameraController]).forEach(function (e) {
    camera.pos[0] = -e.physics.pos.x - camera.shake[0]
    camera.pos[1] = -e.physics.pos.y - camera.shake[1]
    camera.pos[2] = -e.physics.pos.z - camera.shake[2]

    camera.shakeVel[0] += -camera.shake[0] * 0.1
    camera.shakeVel[1] += -camera.shake[1] * 0.1
    camera.shakeVel[2] += -camera.shake[2] * 0.1
    camera.shakeVel[0] *= 0.75
    camera.shakeVel[1] *= 0.75
    camera.shakeVel[2] *= 0.75
    camera.shake[0] += camera.shakeVel[0]
    camera.shake[1] += camera.shakeVel[1]
    camera.shake[2] += camera.shakeVel[2]

    if (key('<up>')) {
      e.physics.vel.z -= Math.cos(camera.rot[1]) * 0.01
      e.physics.vel.x += Math.sin(camera.rot[1]) * 0.01
    }
    if (key('<down>')) {
      e.physics.vel.z += Math.cos(camera.rot[1]) * 0.01
      e.physics.vel.x -= Math.sin(camera.rot[1]) * 0.01
    }
    if (key('<right>')) {
      camera.rot[1] += 0.03
    }
    if (key('<left>')) {
      camera.rot[1] -= 0.03
    }
  })
}

function updateParticles (world, state) {
  world.queryComponents([ParticleEffect]).forEach(function (e, n) {
    e.particleEffect.color[3] -= e.particleEffect.fadeRate

    for (var i=0; i < e.particleEffect.data.length; i++) {
      var p = e.particleEffect.data[i]
      vec3.add(p.pos, p.pos, p.vel)
      vec3.add(p.vel, p.vel, vec3.fromValues(0, -0.003, 0))

      mat4.identity(p.mat)
      mat4.translate(p.mat, p.mat, p.pos)
      mat4.scale(p.mat, p.mat, vec3.fromValues(p.scale, p.scale, p.scale))
      mat4.rotateY(p.mat, p.mat, (state.tick + n * 13) * 0.1)
    }

    if (e.particleEffect.color[3] <= 0) {
      e.remove()
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
  foe.addComponent(TextHolder)
  foe.addComponent(Health)
  foe.health.init(10)
  foe.physics.height = 2
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
  console.log(player.physics.pos)

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
    mat4.scale(model, model, vec3.fromValues(1.0, 1.0, 1.0))
    var rot = -Math.atan2(-camera.pos[2] - z, -camera.pos[0] - x) + Math.PI/2
    mat4.rotateY(model, model, rot)
    chr({
      model: model,
      frame: state.tick % 70 < 35 ? 0 : 0.5,
      view: view,
      texture: texture
    })
  }

  function drawText (text, x, y, z) {
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, vec3.fromValues(x, y, z))
    mat4.scale(model, model, vec3.fromValues(1, -1, 1))
    var rot = -Math.atan2(-camera.pos[2] - z, -camera.pos[0] - x) + Math.PI/2
    mat4.rotateY(model, model, rot)
    text({
      projection: projection,
      view: view,
      model: model
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

  document.body.onkeypress = function (ev) {
    var k = ev.key
    var txt = world.createEntity()
    txt.addComponent(Text3D)
    txt.addComponent(TextProjectile)
    txt.addComponent(Physics)
    txt.text3D.generate(k)

    letters++
    lastLetter = new Date().getTime()

    var plr = world.queryTag('player')[0]
    var yrot = camera.rot[1] - 0.05 + letters*0.01
    txt.physics.pos.x = plr.physics.pos.x + Math.sin(yrot)
    txt.physics.pos.z = plr.physics.pos.z - Math.cos(yrot)
    txt.physics.pos.x += Math.sin(yrot + Math.PI/2) * 0.1
    txt.physics.pos.z -= Math.cos(yrot + Math.PI/2) * 0.1
    txt.physics.pos.y = 3
    txt.physics.vel.x = plr.physics.vel.x + Math.sin(yrot) * 0.8
    txt.physics.vel.z = plr.physics.vel.z - Math.cos(yrot) * 0.8
    txt.physics.vel.y = plr.physics.vel.y - Math.sin(camera.rot[0]) * 0.8 + 0.1
    txt.physics.height = 0.8
    txt.physics.width = 0.2
    txt.physics.depth = 0.2
    txt.physics.friction = 0.3
  }

  var particle = Particle(regl)

  regl.frame(function (state) {
    accum += (new Date().getTime() - last)
    frames++
    if (accum >= 1000) {
      console.log(''+frames, 'FPS')
      frames = 0
      accum = 0
    }
    last = new Date().getTime()

    if (new Date().getTime() - lastLetter > 400) {
      letters = 0
    }

    systems.forEach(function (s) { s(world, state) })

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

    world.queryComponents([TextHolder]).forEach(function (e) {
      if (e.textHolder.draw) {
        drawText(e.textHolder.draw, e.physics.pos.x, e.physics.pos.y + 1.5, e.physics.pos.z)
      }
      e.textHolder.update()
      if (e.textHolder.alpha <= 0) {
        e.textHolder.clear()
      }
    })

    world.queryComponents([Text3D]).forEach(function (e) {
      drawText(e.text3D.draw, e.physics.pos.x, e.physics.pos.y, e.physics.pos.z)

      if (new Date().getTime() > e.text3D.expireTime) {
        e.remove()
        return
      }
    })

    world.queryComponents([Text3D, TextProjectile]).forEach(function (e) {
      world.queryComponents([MobAI, Physics, TextHolder]).forEach(function (m) {
        var dx = m.physics.pos.x - e.physics.pos.x
        var dz = m.physics.pos.z - e.physics.pos.z
        var dist = Math.sqrt(dx*dx + dz*dz)
        if (dist < 1) {
          m.physics.vel.x += e.physics.vel.x * 0.01
          m.physics.vel.z += e.physics.vel.z * 0.01

          spawnParticleHit(vec3.fromValues(e.physics.pos.x, e.physics.pos.y, e.physics.pos.z))

          m.textHolder.add(e.text3D.text)
          e.remove()

          var plr = world.queryTag('player')[0]
          var res = checkLexicon(plr, m, m.textHolder.text)
          if (res) {
            setTimeout(function () {
              if (typeof res === 'function') {
                m.textHolder.setColor([0, 1, 0, 1])
                m.textHolder.fadeOut()
                setTimeout(function () {
                  res(plr, m)
                }, 100)
              }
            }, 300)
          } else {
            if (!m.textHolder.locked) {
              m.textHolder.locked = true
              setTimeout(function () {
                m.textHolder.setColor([1, 0, 0, 1])
                m.textHolder.fadeOut()
              }, 300)
            }
          }
        }
      })
    })

    world.queryComponents([ParticleEffect]).forEach(function (e) {
      var commands = e.particleEffect.data.map(function (d) {
        return {
          projection: projection,
          view: view,
          model: d.mat,
          color: e.particleEffect.color
        }
      })
      e.particleEffect.draw(commands)
    })

    world.queryComponents([MobAI, Physics]).forEach(function (e) {
      drawBillboard(state, e.physics.pos.x, e.physics.pos.y, e.physics.pos.z, assets.foe)
    })
  })
}
