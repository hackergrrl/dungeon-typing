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
var Meter = require('./meter')

var screenWidth, screenHeight
var tick = 0

var textures = {}

var currentLevel = 1

var camera = {
  pos: [0, -2, -10],
  rot: [0, 0, 0],
  shake: [0, 0, 0],
  shakeVel: [0, 0, 0]
}

var lexicon = {
  'hit':   hitCommand.bind(null, '2d3+0'),
  'slam':  slamCommand.bind(null, '1d5+2'),
  'open':  openCommand,
  'close': closeCommand,
  'get': getCommand,
}

var letters = 0
var lastLetter = 0

var systems = [
  updatePhysics,
  updateCamera,
  updateMobAI,
  updateParticles,
  function () { world.queryComponents([Floaty, Physics]).forEach(function (e) { e.floaty.update() }) },
]

var projection

var world
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

function canSee (a, b) {
  var x = a.physics.pos.x
  var z = a.physics.pos.z
  var dx = b.physics.pos.x - a.physics.pos.x
  var dz = b.physics.pos.z - a.physics.pos.z
  var len = Math.sqrt(dx*dx + dz*dz)
  dx /= len
  dz /= len

  var doors = world.queryComponents([Door, Physics])

  var steps = 0
  while (steps < 100) {
    steps++

    x += dx
    z += dz
    if (isSolid(x, z)) {
      return false
    }

    for (var i=0; i < doors.length; i++) {
      var d = doors[i]
      if (d.door.open) continue
      var dist = xyzDistance(d, x, 2, z)
      if (dist <= d.physics.width/2) return false
    }

    var ddx = b.physics.pos.x - x
    var ddz = b.physics.pos.z - z
    var dist = Math.sqrt(ddx*ddx + ddz*ddz)
    if (dist <= 1) return true
  }

  return false
}

function spawnParticleLevelUp (at) {
  var parts = world.createEntity()
  parts.addComponent(ParticleEffect)
  parts.particleEffect.init({
    count: 25,
    pos: at,
    speed: 0.02,
    fadeRate: 0.01,
    color: [1, 1, 0.1, 1]
  })
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
  parts.particleEffect.init({
    count: 10,
    pos: at,
    speed: 0.025,
    fadeRate: 0.01,
    color: [1, 0, 0, 0.2]
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
  text = text.toLowerCase()
  var words = Object.keys(lexicon)

  for (var j=0; j < words.length; j++) {
    var word = words[j]
    if (word == text) return lexicon[text]
    if (word.startsWith(text)) return true
  }
  return false
}

function rollDice (str) {
  var rolls = Number(str.split('d')[0])
  var sides = Number(str.split('+')[0].split('d')[1])
  var add = Number(str.split('+')[1])

  var res = add
  for (var i=0; i < rolls; i++) {
    res += Math.floor(Math.random() * sides) + 1
  }

  return res
}

function queryInCircle (components, center, radius) {
  if (components.indexOf(Physics) === -1) return []

  return world.queryComponents(components)
    .filter(function (e) {
      return xyzDistance(e, center[0], center[1], center[2]) <= radius
    })
}

// Close a door. Really hard.
function slamCommand (dice, attacker, target) {
  if (closeCommand(attacker, target)) {
    var center = vecify(target.physics.pos)
    queryInCircle([Physics, Health], center, 4).forEach(function (e) {
      spawnParticleStrike(vecify(e.physics.pos))
      e.health.damage(rollDice(dice), attacker)
    })
  }
}

function hitCommand (dice, attacker, target) {
  var dmg = rollDice(dice)

  var player = world.queryTag('player')[0]
  var mult = 1
  if (attacker !== player) mult = -0.5

  var dist = physicsDistance(attacker, target)
  if (dist <= 4) {
    camera.shakeVel[0] = Math.sin(camera.rot[1]) * 0.5 * mult
    camera.shakeVel[1] = 0
    camera.shakeVel[2] = -Math.cos(camera.rot[1]) * 0.5 * mult

    target.physics.vel.x += Math.sin(camera.rot[1]) * 0.1 * mult
    target.physics.vel.z += -Math.cos(camera.rot[1]) * 0.1 * mult
    if (mult === 1) {
      spawnParticleStrike(vecify(target.physics.pos))
    } else {
      spawnParticleBlood(vecify(target.physics.pos))
    }
    target.health.damage(dmg, attacker)
    return true
  } else {
    return false
  }
}

function openCommand (user, target) {
  if (!target.door || target.door.open) return false
  target.billboardSprite.frameX = 1
  target.physics.width /= 2
  target.physics.depth /= 2
  target.physics.pos.x += Math.sin(target.door.rot - Math.PI/2) * 1.5
  target.physics.pos.z -= Math.cos(target.door.rot - Math.PI/2) * 1.5
  target.door.open = true
  target.physicsCone.radius = 0.5
  return true
}

function closeCommand (user, target) {
  if (!target.door || !target.door.open) return false
  target.billboardSprite.frameX = 0
  target.physics.width *= 2
  target.physics.depth *= 2
  target.physics.pos.x += -Math.sin(target.door.rot - Math.PI/2) * 1.5
  target.physics.pos.z -= -Math.cos(target.door.rot - Math.PI/2) * 1.5
  target.door.open = false
  target.physicsCone.radius = 4
  return true
}

function getCommand (user, target) {
  if (!target.item) return false
  if (physicsDistance(user, target) > 5) return false
  return user.inventory.pickup(target)
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
  this.movable = true
  this.pos = {
    x: 0,
    y: 0,
    z: 0
  }
  this.width = 4
  this.length = 4
  this.height = 4

  this.gravity = 1
  this.friction = 0.94

  this.vel = {
    x: 0,
    y: 0,
    z: 0
  }
}

function PhysicsCone (e, radius) {
  this.radius = radius || 4
}

function Floaty (e) {
  this.update = function () {
    var now = new Date().getTime()
    e.physics.gravity = 0
    e.physics.vel.y = 0
    e.physics.pos.y += Math.sin(now * 0.003) * 0.002
  }
}

function Player (e) {
  this.update = function () {
    if (getTileAt(e.physics.pos.x, 0, e.physics.pos.z) === 'exit') {
      currentLevel++
      createLevel(currentLevel)
    }
  }
}

function Door () {
  this.open = false
  this.rot = 0
}

function MobAI (e) {
  e.on('damage', function (amount) {
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
  e.on('death', function (attacker) {
    if (attacker.level) {
      attacker.level.gain(e.mobAI.xp || 0)
    }
    process.nextTick(function () {
      e.remove()
    })
  })
}

function BillboardSprite (e, tname, frameSize) {
  this.texture = null
  this.frameX = 0
  this.frameY = 0
  this.framesWide = (frameSize || [])[0] || 2
  this.framesTall = (frameSize || [])[1] || 1
  this.scale = 1
  this.texture = tname
  this.visible = true
}

function Health (e, max) {
  this.amount = 100
  this.max = 100
  this.amount = this.max = max

  this.damage = function (num, attacker) {
    if (this.amount <= 0) return

    this.amount -= num
    e.emit('damage', num)
    if (this.amount <= 0) {
      e.emit('death', attacker)
    }
  }
}

function Mana (e, max) {
  this.amount = 100
  this.max = 100
  this.amount = this.max = max

  this.spend = function (num) {
    if (this.amount - num < 0) return false
    this.amount -= num
    return true
  }
}

function Level (e) {
  this.xp = 0
  this.xpNext = 50
  this.level = 1

  this.gain = function (xp) {
    this.xp += xp
    if (this.xp >= this.xpNext) {
      this.level++
      this.xp = (this.xp - this.xpNext)
      this.xpNext = Math.floor(this.xpNext * 1.2)
      e.emit('level-up', this.level)
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

function Text2D () {
  this.generate = function (string, color) {
    this.draw = Text(regl, string, color || undefined)
    this.text = string
  }

  this.x = this.y = 0
  this.draw = undefined
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

function Item (e) {
  this.owner = null
}

function Inventory (e) {
  this.contents = []

  this.pickup = function (i) {
    i.billboardSprite.visible = false
    i.item.owner = e
    i.removeComponent(Physics)
    this.contents.push(i)
    return true
  }
}

function createGuiLabel (text, x, y, color) {
  var txt = world.createEntity()
  txt.addComponent(Text2D)
  txt.text2D.generate(text, color)
  txt.text2D.x = x
  txt.text2D.y = y
  return txt
}

function notify (text, color, cb) {
  if (typeof color === 'function') {
    cb = color
    color = null
  }
  color = color || [1,1,1,1]
  var e = createGuiLabel(text, screenWidth/2, screenHeight/2, color)
  setTimeout(function () {
    e.remove()
    if (cb) cb()
  }, text.length * 100)
}

function tex (fn) {
  return {
    type: 'image',
    src: 'assets/' + fn,
    parser: function (data) {
      var tex = regl.texture({
        data: data,
        min: 'nearest',
        mag: 'nearest'
      })
      textures[fn] = {
        width: data.width,
        height: data.height,
        texture: tex
      }
      return tex
    }
  }
}

require('resl')({
  manifest: {
    atlas: tex('atlas.png'),
    foe: tex('foe.png'),
    chest: tex('chest.png'),
    potions: tex('potions.png'),
    door: tex('door.png'),
    food: tex('food.png'),
    apple: tex('apple.png')
  },
  onDone: run
})

document.body.onkeypress = function (ev) {
  var plr = world.queryTag('player')[0]
  if (plr.health.amount <= 0) return

  var k = ev.key
  if (k.startsWith('Arrow')) return
  var txt = world.createEntity()
  txt.addComponent(Text3D)
  txt.addComponent(TextProjectile)
  txt.addComponent(Physics)
  txt.text3D.generate(k)

  letters++
  lastLetter = new Date().getTime()

  var yrot = camera.rot[1]
  txt.physics.pos.x = plr.physics.pos.x + Math.sin(yrot)
  txt.physics.pos.z = plr.physics.pos.z - Math.cos(yrot)
  txt.physics.pos.x += Math.sin(yrot + Math.PI/2) * 0.3
  txt.physics.pos.z -= Math.cos(yrot + Math.PI/2) * 0.3
  txt.physics.pos.y = 3
  txt.physics.vel.x = plr.physics.vel.x + Math.sin(yrot) * 0.8
  txt.physics.vel.z = plr.physics.vel.z - Math.cos(yrot) * 0.8
  txt.physics.vel.y = plr.physics.vel.y - Math.sin(camera.rot[0]) * 0.8 + 0.1
  txt.physics.height = 0.8
  txt.physics.width = 0.2
  txt.physics.depth = 0.2
  txt.physics.friction = 0.3
}

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

function getTileAt (x, y, z) {
  x /= 2
  y /= 2
  z /= 2
  z += 0.5
  y += 0.5
  x += 0.5
  if (x < 0 || z < 0 || x >= map.width || z >= map.depth) {
    return null
  }
  return map.get(Math.floor(x), Math.floor(y), Math.floor(z))
}

function isSolid (x, z) {
  return !!getTileAt(x, 2, z)
}

function updateMobAI (world) {
  world.queryComponents([MobAI, Physics]).forEach(function (e) {
    e.billboardSprite.frameX = tick % 70 < 35 ? 0 : 1

    var plr = world.queryTag('player')[0]
    if (plr.health.amount <= 0) return
    if (!canSee(e, plr)) return
    var dx = plr.physics.pos.x - e.physics.pos.x
    var dz = plr.physics.pos.z - e.physics.pos.z
    var dist = Math.sqrt(dx*dx + dz*dz)
    if (dist > 3) {
      dx /= dist
      dz /= dist
      e.physics.vel.x += dx * 0.002
      e.physics.vel.z += dz * 0.002
    } else {
      if (!e.mobAI.nextAttack || e.mobAI.nextAttack <= new Date().getTime()) {
        hitCommand('1d2+0', e, plr)
        e.mobAI.nextAttack = new Date().getTime() + 1500
      }
    }
  })
}

function updatePhysics (world) {
  world.queryComponents([Physics]).forEach(function (e) {
    // gravity
    e.physics.vel.y -= 0.006 * e.physics.gravity

    // physics cone collisions
    if (e.physicsCone) {
      world.queryComponents([Physics, PhysicsCone]).forEach(function (d) {
        if (e.id === d.id) return
        var toTarget = vec3.sub(vec3.create(), vecify(e.physics.pos), vecify(d.physics.pos))

        // fix doors on top of doors (not pretty)
        if (e.door && d.door) {
          if (vec3.length(toTarget) <= d.physics.width) {
            d.remove()
            return
          }
        }

        var toTarget = vec3.sub(vec3.create(), vecify(e.physics.pos), vecify(d.physics.pos))
        if (vec3.length(toTarget) <= d.physicsCone.radius) {
          vec3.normalize(toTarget, toTarget)
          vec3.scale(toTarget, toTarget, 0.01)
          e.physics.vel.x += toTarget[0]
          e.physics.vel.y += toTarget[1]
          e.physics.vel.z += toTarget[2]
        }
      })
    }

    // wall collisions; test x and z separately
    var tx = e.physics.pos.x + e.physics.vel.x
    if (isSolid(tx, e.physics.pos.z)) {
      e.physics.vel.x *= -0.3
    }
    var tz = e.physics.pos.z + e.physics.vel.z
    if (isSolid(e.physics.pos.x, tz)) {
      e.physics.vel.z *= -0.3
    }

    if (!e.physics.movable) {
      e.physics.vel.x = 0
      e.physics.vel.y = 0
      e.physics.vel.z = 0
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

    if (e.health.amount <= 0) return

    if (key('<up>')) {
      e.physics.vel.z -= Math.cos(camera.rot[1]) * 0.008
      e.physics.vel.x += Math.sin(camera.rot[1]) * 0.008
    }
    if (key('<down>')) {
      e.physics.vel.z += Math.cos(camera.rot[1]) * 0.005
      e.physics.vel.x -= Math.sin(camera.rot[1]) * 0.005
    }
    if (key('<right>')) {
      camera.rot[1] += 0.04
    }
    if (key('<left>')) {
      camera.rot[1] -= 0.04
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

function createLevel (level) {
  if (!world) world = nano()
  var player = world.queryTag('player')[0]

  world.queryComponents([MobAI]).slice().forEach(function (e) { e.remove() })
  world.queryComponents([Door]).slice().forEach(function (e) { e.remove() })

  if (!player) {
    player = world.createEntity()
    player.addComponent(Player)
    player.addComponent(Physics)
    player.addComponent(PhysicsCone, 2)
    player.addComponent(CameraController)
    player.addComponent(Health, 30)
    player.addComponent(Mana, 12)
    player.addComponent(Inventory)
    player.addComponent(Level)
    player.addTag('player')
    player.on('death', function () {
      player.physics.height = 0.5
      player.physics.vel.y = 1
      player.physics.pos.y += 1
      camera.rot[2] = Math.PI/7
      camera.rot[0] = -Math.PI/5
      console.log('you are remarkably dead')
    })
    player.on('level-up', function () {
      spawnParticleLevelUp(vecify(player.physics.pos))
      player.health.max = Math.floor(player.health.max * 1.1)
      player.health.amount = player.health.max
      player.mana.max = Math.floor(player.mana.max * 1.1)
      player.mana.amount = player.mana.max
      // TODO: increase melee damage?
      notify('    Welcome to Level ' + player.level.level + '    ')
    })
  }

  // alloc + config map
  map = new Voxel(regl, 50, 10, 50, textures['atlas.png'], 16, 16)
  var v = level
  var roof = (level - 1) % 2
  var floor = (level - 1) % 8
  map.defineTile('block1', [floor, 2], [roof, 1], [roof, 1])
  map.defineTile('exit',   [2, 0], [roof, 1], [roof, 1])
  var dun = generateLevel(25, 25)
  for (var i=0; i < map.width; i++) {
    for (var j=0; j < map.depth; j++) {
      for (var k=0; k < map.height; k++) {
        if (k >= 1 && k <= 2) {
          var x = Math.floor(i / 2)
          var y = Math.floor(j / 2)
          map.set(i, k, j, dun.walls.get([x, y]) ? 'block1' : null)
        } else {
          map.set(i, k, j, 'block1')
        }
      }
    }
  }

  var room = dun.initial_room
  var player = world.queryTag('player')[0]
  player.physics.pos.x = (room.position[0] + room.size[0]) * 2
  player.physics.pos.z = (room.position[1] + room.size[1]) * 2
  player.physics.pos.y = 4
  camera.rot[1] = -Math.PI

  var apple = world.createEntity()
  apple.addComponent(BillboardSprite, 'apple.png', [1,1])
  apple.billboardSprite.scale = 0.5
  apple.addComponent(Physics)
  apple.addComponent(Item)
  apple.addComponent(TextHolder)
  apple.addComponent(Floaty)
  apple.physics.height = 3
  apple.physics.pos.x = player.physics.pos.x
  apple.physics.pos.y = player.physics.pos.y - 2
  apple.physics.pos.z = player.physics.pos.z + 1

  while (true) {
    var room = dun.children[Math.floor(Math.random() * dun.children.length)]
    if (room.room_size[0] <= 1 || room.room_size[1] <= 1) continue
    if (room === dun.initial_room) continue
    var ex = (room.position[0] + Math.floor(room.size[0]/2)) * 2
    var ez = (room.position[1] + Math.floor(room.size[1]/2)) * 2
    map.set(ex, 0, ez, 'exit')
    break
  }

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

  dun.children.forEach(function (room) {
    if (room.id === dun.initial_room.id) return

    var numFoes = Math.max(0, Math.floor(Math.random() * 5) - 1)
    for (var i=0; i < numFoes; i++) {
      var x = (room.position[0] + (Math.random() * (room.room_size[0]-1)) + 1) * 4
      var z = (room.position[1] + (Math.random() * (room.room_size[1]-1)) + 1) * 4
      var foe = world.createEntity()
      foe.addComponent(Physics)
      foe.addComponent(BillboardSprite, 'foe.png')
      foe.addComponent(MobAI)
      foe.addComponent(PhysicsCone, 2)
      foe.addComponent(TextHolder)
      foe.addComponent(Health, 6)
      foe.mobAI.xp = 8
      foe.physics.height = 2
      foe.physics.pos.x = x
      foe.physics.pos.z = z
      foe.physics.pos.y = 5
    }

    room.exits.forEach(function (exit) {
      var rot = exit[1] * Math.PI / 180
      var x = (room.position[0] + exit[0][0]) * 4 + 1
      var z = (room.position[1] + exit[0][1]) * 4 + 1
      var door = world.createEntity()
      door.addComponent(Physics)
      door.addComponent(Door)
      door.addComponent(PhysicsCone)
      door.door.rot = rot
      door.addComponent(BillboardSprite, 'door.png')
      door.addComponent(TextHolder)
      door.addComponent(Health, 50)
      door.billboardSprite.scale = 2
      door.physics.movable = false
      door.physics.height = 4
      door.physics.width = 4
      door.physics.depth = 4
      door.physics.pos.x = x
      door.physics.pos.z = z
      door.physics.pos.y = 2
    })
  })

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
}

function surroundedSolid (map, x, y, z) {
  var vals = []
  vals.push(map.isSolid(x, y, z))
  vals.push(map.isSolid(x - 1, y, z))
  vals.push(map.isSolid(x + 1, y, z))
  vals.push(map.isSolid(x, y - 1, z))
  vals.push(map.isSolid(x, y + 1, z))
  vals.push(map.isSolid(x, y, z - 1))
  vals.push(map.isSolid(x, y, z + 1))
  for (var i=0; i < vals.length; i++) {
    if (vals[i] !== vals[0]) return false
  }
  return true
}

function updateLights (lights) {
  var n = 0
  for (var i=0; i < map.width; i++) {
    for (var j=0; j < map.depth; j++) {
      for (var k=0; k < map.height; k++) {
        if (surroundedSolid(map, i, k, j)) continue
        lights.forEach(function (light) {
          var lightPos = vec3.fromValues(light.pos.x, light.pos.y, light.pos.z)
	  n++
          map.lightBoxAdd(i, k, j, function (pos, normal) {
            var br = pointLight(lightPos, light.intensity, pos, normal)
            return [br * 226/255, br * 188/255, br * 134/255]
          })
        })
      }
    }
  }
  var total = map.width * map.height * map.depth * lights.length
  var per = (100 * n / total).toFixed(0)
  console.log('lighting calculations:', per + '% of map')
}

function pickFreeTile () {
  var tries = 150
  while (tries > 0) {
    tries--
    var x = Math.floor(Math.random() * map.width)
    var z = Math.floor(Math.random() * map.depth)
    if (!isSolid(x, z)) {
      return [x, z]
    }
  }
}

function run (assets) {
  var accum = 0
  var frames = 0
  var last = new Date().getTime()

  createLevel(1)

  process.nextTick(function () {
    var x = 24
    Object.keys(lexicon).forEach(function (word) {
      createGuiLabel(word, x, 32, [1, 1, 1, 1])
      x += word.length * 16 + 32
    })

    notify('Welcome to DUNGEON TYPIST', function () {
      notify('Your commands are listed along the bottom of the screen', function () {
        notify('Try typing OPEN at the door', function () {
          notify('Type HIT at monsters', function () {
          })
        })
      })
    })
  })

  var view = mat4.lookAt([],
                        [0, 0, -30],
                        [0, 0.0, 0],
                        [0, 1, 0])

  var sky = Sky(regl)

  var hpMeter = Meter(regl, [0.75, 0.8], [1, 0,    0, 0.75])
  var mpMeter = Meter(regl, [0.83, 0.8], [0, 0,    1, 0.75])
  var xpMeter = Meter(regl, [0.91, 0.8], [0, 0.65, 0, 0.5])

  var billboard = Billboard(regl, 2, 1)

  function drawBillboard (e) {
    var tex = textures[e.billboardSprite.texture]
    var at = vecify(e.physics.pos)
    var scale = e.billboardSprite.scale
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, at)
    mat4.scale(model, model, vec3.fromValues(scale, scale, scale))
    var rot = -Math.atan2(-camera.pos[2] - at[2], -camera.pos[0] - at[0]) + Math.PI/2
    mat4.rotateY(model, model, rot)
    billboard({
      model: model,
      framesWide: 1 / e.billboardSprite.framesWide,
      framesTall: 1 / e.billboardSprite.framesTall,
      frameX: e.billboardSprite.frameX / e.billboardSprite.framesWide,
      frameY: e.billboardSprite.frameY / e.billboardSprite.framesTall,
      view: view,
      texture: tex.texture
    })
  }

  function drawText2D (text, x, y) {
    var proj = mat4.ortho(mat4.create(), 0, screenWidth, screenHeight, 0, -1, 1)
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, vec3.fromValues(x, y, -0.2))
    mat4.scale(model, model, vec3.fromValues(25, 25, 25))
    text({
      projection: proj,
      view: mat4.create(),
      model: model
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

  var particle = Particle(regl)

  regl.frame(function (state) {
    tick = state.tick
    screenWidth = state.viewportWidth
    screenHeight = state.viewportHeight

    // fps
    accum += (new Date().getTime() - last)
    frames++
    if (accum >= 1000) {
      // console.log(''+frames, 'FPS')
      frames = 0
      accum = 0
    }
    last = new Date().getTime()

    // letter accumulator
    if (new Date().getTime() - lastLetter > 400) {
      letters = 0
    }

    // Update all systems
    systems.forEach(function (s) { s(world, state) })

    projection = mat4.perspective([],
                                  Math.PI / 3,
                                  state.viewportWidth / state.viewportHeight,
                                  0.01,
                                  1000)

    // Sync camera to view matrix
    mat4.identity(view)
    mat4.rotateX(view, view, camera.rot[0])
    mat4.rotateY(view, view, camera.rot[1])
    mat4.rotateZ(view, view, camera.rot[2])
    mat4.translate(view, view, camera.pos)

    // Clear screen
    regl.clear({
      color: [0, 0, 0, 1],
      depth: 1
    })

    // Draw sky bg
    sky()

    // Draw voxel world
    map.draw({
      projection: projection,
      view: view
    })

    // Player logic
    world.queryComponents([Player]).forEach(function (e) {
      e.player.update()
    })

    // Draw text over targets
    world.queryComponents([Physics, TextHolder]).forEach(function (e) {
      if (e.textHolder.draw) {
        drawText(e.textHolder.draw, e.physics.pos.x, e.physics.pos.y + 1.5, e.physics.pos.z)
      }
      e.textHolder.update()
      if (e.textHolder.alpha <= 0) {
        e.textHolder.clear()
      }
    })

    // Draw player letter-projectiles
    world.queryComponents([Text3D]).forEach(function (e) {
      drawText(e.text3D.draw, e.physics.pos.x, e.physics.pos.y, e.physics.pos.z)

      if (new Date().getTime() > e.text3D.expireTime) {
        e.remove()
        return
      }
    })

    // Collisions (player text vs mobs)
    world.queryComponents([Text3D, TextProjectile]).forEach(function (e) {
      var done = false
      world.queryComponents([Physics, TextHolder]).forEach(function (m) {
        if (done) return
        var dx = m.physics.pos.x - e.physics.pos.x
        var dz = m.physics.pos.z - e.physics.pos.z
        var dist = Math.sqrt(dx*dx + dz*dz)
        if (dist < m.physics.width/2) {
          //m.physics.vel.x += e.physics.vel.x * 0.01
          //m.physics.vel.z += e.physics.vel.z * 0.01

          m.textHolder.add(e.text3D.text)
          e.remove()
          done = true

          var plr = world.queryTag('player')[0]
          var res = checkLexicon(plr, m, m.textHolder.text)
          if (res) {
            setTimeout(function () {
              if (typeof res === 'function') {
                var ok = res(plr, m)
                if (ok) m.textHolder.setColor([0, 1, 0, 1])
                else  m.textHolder.setColor([0.5, 0.5, 0.5, 1])
                m.textHolder.fadeOut()
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

    var plr = world.queryTag('player')[0]

    // Draw billboard sprites
    var bills = world.queryComponents([BillboardSprite, Physics])
    bills.sort(distCmp.bind(null, plr))
    bills.forEach(function (e) {
      if (e.billboardSprite.visible) drawBillboard(e)
    })

    // GUI meters
    var hp = plr.health.amount / plr.health.max
    var mp = plr.mana.amount / plr.mana.max
    var hpDanger = (1 - hp) * 0.4
    var mpDanger = (1 - mp) * 0.4
    hpMeter(Math.floor(plr.health.amount * 0.5), Math.floor(plr.health.max * 0.5), state.tick, hpDanger)
    mpMeter(Math.floor(plr.mana.amount * 0.5), Math.floor(plr.mana.max * 0.5), state.tick, mpDanger)
    var xp = plr.level.xp / plr.level.xpNext
    xpMeter(Math.floor(xp * 40), 40, state.tick, 0.0)


    // GUI text
    world.queryComponents([Text2D]).forEach(function (e) {
      drawText2D(e.text2D.draw, e.text2D.x, e.text2D.y)
    })

    // Draw particle effects
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
  })
}

function distCmp (plr, a, b) {
  var aDist = physicsDistance(plr, a)
  var bDist = physicsDistance(plr, b)
  return bDist - aDist
}
