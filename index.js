var regl = require('regl')()
var vec3 = require('gl-vec3')
var mat4 = require('gl-mat4')
var key = require('key-pressed')
var Voxel = require('./voxel')
var dungeon = require('dungeon-generator')
var Sky = require('./sky')
var nano = require('nano-ecs')
var Billboard = require('./billboard')
var Text = require('./text')
var ParticleSystem = require('./particle')
var Meter = require('./meter')
var u = require('./utils')
var GuiLexicon = require('./gui_lexicon')
var GuiInventory = require('./gui_inventory')

var texture = {}
var atlas = {}

var screenWidth, screenHeight
var tick = 0
var currentLevel = 1
var camera = {
  pos: [0, -2, -10],
  rot: [0, 0, 0],
  shake: [0, 0, 0],
  shakeVel: [0, 0, 0]
}

var letters = 0
var lastLetter = 0

var guiLexicon = new GuiLexicon(regl)
var guiInventory = new GuiInventory(regl)

var inventorySelected = null

var projectionWorld
var projectionScreen

var world
var map

var lexicon = {
  // Combat
  'hit':   hitCommand.bind(null, '2d3+0'),
  'bash':  bashCommand.bind(null, '1d3+0'),

  // Doors
  'open':  openCommand,
  'close': closeCommand,
  'slam':  slamCommand.bind(null, '1d5+2'),

  // Items
  'get':   getCommand,
  'THROW': throwCommand,

  // Food
  'EAT':   eatCommand,

  // Potions
  'QUAFF': quaffCommand,
}

var systems = [
  updatePhysics,
  updateCamera,
  updateMobAI,
  updateParticles,
]

function addSpriteToAtlas (atlas, name, fx, fy, frameWidth, frameHeight, framesAcross) {
  var um = (frameWidth / atlas.texture.width)
  var vm = (frameHeight / atlas.texture.height)
  var bu = um * fx
  var bv = vm * fy
  atlas[name] = { texture: atlas.texture }
  atlas[name].uvs = (new Array(framesAcross))
    .fill(0)
    .map(function (_, n) {
      var u = bu + um * n
      var v = bv
      return [
        [ u,      v      ],
        [ u + um, v      ],
        [ u + um, v + vm ],

        [ u,      v      ],
        [ u + um, v + vm ],
        [ u,      v + vm ]
      ]
    })
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
      var dist = u.xyzDistance(d, x, 2, z)
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
  var words = plr.player.lexicon

  for (var j=0; j < words.length; j++) {
    var word = words[j]
    if (word == text) return lexicon[text]
    if (word.startsWith(text)) return true
  }
  return false
}

function queryInCircle (components, center, radius) {
  if (components.indexOf(Physics) === -1) return []

  return world.queryComponents(components)
    .filter(function (e) {
      return u.xyzDistance(e, center[0], center[1], center[2]) <= radius
    })
}

// Close a door. Really hard.
function slamCommand (dice, attacker, target) {
  if (closeCommand(attacker, target)) {
    var center = u.vecify(target.physics.pos)
    queryInCircle([Physics, Health], center, 4).forEach(function (e) {
      spawnParticleStrike(u.vecify(e.physics.pos))
      e.health.damage(u.rollDice(dice), attacker)
    })
  }
}

function melee (opts) {
  // opts.dice, opts.attacker, opts.target, opts.pushback, opts.distance, opts.lunge

  var dmg = u.rollDice(opts.dice)

  var player = world.queryTag('player')[0]
  var mult = 1
  if (opts.attacker !== player) mult = -0.5

  var dist = u.physicsDistance(opts.attacker, opts.target)
  if (dist <= opts.distance) {
    // camera lunge
    camera.shakeVel[0] = Math.sin(camera.rot[1]) * opts.lunge * mult
    camera.shakeVel[1] = 0
    camera.shakeVel[2] = -Math.cos(camera.rot[1]) * opts.lunge * mult

    // pushback
    opts.target.physics.vel.x += Math.sin(camera.rot[1]) * opts.pushback * mult
    opts.target.physics.vel.z += -Math.cos(camera.rot[1]) * opts.pushback * mult

    // damage + effect
    if (opts.target.health) {
      if (mult === 1) {
        spawnParticleStrike(u.vecify(opts.target.physics.pos))
      } else {
        spawnParticleBlood(u.vecify(opts.target.physics.pos))
      }
      opts.target.health.damage(dmg, opts.attacker)
    }
    return true
  } else {
    return false
  }
}

function hitCommand (dice, attacker, target) {
  melee({
    dice: dice,
    attacker: attacker,
    target: target,
    lunge: 0.5,
    pushback: 0.1,
    distance: 4
  })
}

function bashCommand (dice, attacker, target) {
  melee({
    dice: dice,
    attacker: attacker,
    target: target,
    lunge: 1.0,
    pushback: 0.6,
    distance: 4
  })
}

function openCommand (user, target) {
  if (!target.door || target.door.open) return false
  target.billboardSprite.frameX = 1
  target.physics.width /= 2
  target.physics.depth /= 2
  target.physics.pos.x += Math.sin(target.door.rot - Math.PI/2) * 1.5
  target.physics.pos.z -= Math.cos(target.door.rot - Math.PI/2) * 1.5
  target.door.open = true
  target.physicsCone.radius = 0.1
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
  if (u.physicsDistance(user, target) > 5) return false
  return user.inventory.pickup(target)
}

function throwCommand (user, target) {
  var item = user.inventory.contents[inventorySelected]
  if (!item) return false

  user.inventory.drop(item)

  var yrot = camera.rot[1]
  var spawnDist = user.physicsCone.radius + item.physicsCone.radius
  item.physics.pos.x = user.physics.pos.x + Math.sin(yrot) * spawnDist
  item.physics.pos.z = user.physics.pos.z - Math.cos(yrot) * spawnDist
  item.physics.pos.x += Math.sin(yrot + Math.PI/2) * 0.3
  item.physics.pos.z -= Math.cos(yrot + Math.PI/2) * 0.3
  item.physics.pos.y = 3
  item.physics.vel.x = user.physics.vel.x + Math.sin(yrot) * 0.8
  item.physics.vel.z = user.physics.vel.z - Math.cos(yrot) * 0.8
  item.physics.vel.y = user.physics.vel.y - Math.sin(camera.rot[0]) * 0.8 + 0.1

  return true
}

function eatCommand (user) {
  var item = user.inventory.contents[inventorySelected]
  if (!item) return false
  if (!item.food) return false

  user.inventory.drop(item)

  user.health.heal(item.food.healAmount, item)

  item.remove()
}

function quaffCommand (user) {
  var item = user.inventory.contents[inventorySelected]
  if (!item) return false
  if (!item.potion) return false

  user.inventory.drop(item)

  user.health.heal(100, item)

  item.remove()
}

function getObjectAt (x, y, z, radius) {
  var match
  world.queryComponents([Physics]).forEach(function (e) {
    var dist = u.xyzDistance(e, x, y, z)
    if (dist <= radius) {
      match = e
    }
  })
  return match
}

// gravity-affected, bounding box vs tilemap, position
function Physics (e, mass) {
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

  this.mass = mass || 1

  this.vel = {
    x: 0,
    y: 0,
    z: 0
  }
}

function PhysicsCone (e, radius) {
  this.radius = radius || 4
}

function Identity (e, name, desc) {
  this.name = name || 'a nondescript object'
  this.description = desc || 'This object is remarkable in how ambiguous and unidentifiable it is.'
}

function Player (e) {
  this.update = function () {
    if (getTileAt(e.physics.pos.x, 0, e.physics.pos.z) === 'exit') {
      currentLevel++
      createLevel(currentLevel)
    }
  }

  this.lexicon = ['hit', 'open', 'close', 'get', 'bash']
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

function Sprite2D (e, x, y) {
  this.x = x
  this.y = y
}

function BillboardSprite (e, sprite, frameSize) {
  this.frameX = 0
  this.frameY = 0
  this.framesWide = (frameSize || [])[0] || 2
  this.framesTall = (frameSize || [])[1] || 1
  this.scale = 1
  this.sprite = sprite
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

  this.heal = function (num, via) {
    var toAdd = Math.min(num, this.max - this.amount)
    this.amount += toAdd
    e.emit('heal', toAdd, via)
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

function Food () {
  this.healAmount = 10
}

function Potion () {
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

  this.scale = 1
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
  this.scale = 1.0
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
  this.lexicon = {}
}

function Inventory (e) {
  this.contents = []

  this.pickup = function (i) {
    i.billboardSprite.visible = false
    i.item.owner = e
    i.physics.pos.x = Infinity
    i.physics.pos.y = Infinity
    i.physics.pos.z = Infinity
    this.contents.push(i)
    e.emit('pickup-item', i)
    return true
  }

  this.drop = function (i) {
    i.billboardSprite.visible = true
    i.item.owner = null
    i.physics.pos.x = e.physics.pos.x
    i.physics.pos.y = e.physics.pos.y
    i.physics.pos.z = e.physics.pos.z
    i.physics.vel.x = 0
    i.physics.vel.y = 0
    i.physics.vel.z = 0
    e.emit('drop-item', i)
    this.contents.splice(this.contents.indexOf(i), 1)
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
      texture[fn] = {
        width: data.width,
        height: data.height,
        data: tex
      }
      return tex
    }
  }
}

function sprite (name) {
  var textureName = name.split('/')[0]
  var spriteName = name.split('/')[1]
  return atlas[textureName][spriteName]
}

function loadResources (cb) {
  require('resl')({
    manifest: {
      atlas: tex('atlas.png'),
      foe: tex('foe.png'),
      chest: tex('chest.png'),
      potions: tex('potions.png'),
      door: tex('door.png'),
      food: tex('food.png')
    },
    onDone: done
  })

  function done () {
    atlas['food'] = { texture: texture['food.png'] }
    addSpriteToAtlas(atlas['food'], 'apple',  0, 2, 16, 16, 1)
    addSpriteToAtlas(atlas['food'], 'orange', 1, 2, 16, 16, 1)
    addSpriteToAtlas(atlas['food'], 'banana', 4, 2, 16, 16, 1)
    addSpriteToAtlas(atlas['food'], 'tomato', 5, 2, 16, 16, 1)

    atlas['door'] = { texture: texture['door.png'] }
    addSpriteToAtlas(atlas['door'], 'door', 0, 0, 16, 16, 2)

    atlas['foe'] = { texture: texture['foe.png'] }
    addSpriteToAtlas(atlas['foe'], 'foe', 0, 0, 16, 16, 2)

    atlas['potion'] = { texture: texture['potions.png'] }
    for (var i = 0; i < 24; i++) {
      var x = i % 8
      var y = Math.floor(i / 8)
      addSpriteToAtlas(atlas['potion'], 'potion_' + i, x, y, 16, 16, 1)
    }

    cb()
  }
}

loadResources(run)

document.body.onkeypress = function (ev) {
  var plr = world.queryTag('player')[0]
  if (plr.health.amount <= 0) return

  var k = ev.key
  if (/^[0-9]$/.test(k)) {
    plr.emit('select-item', Number(k))
    return
  }
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
        var toTarget = vec3.sub(vec3.create(), u.vecify(e.physics.pos), u.vecify(d.physics.pos))

        // fix doors on top of doors (not pretty)
        if (e.door && d.door) {
          if (vec3.length(toTarget) <= d.physics.width) {
            d.remove()
            return
          }
        }

        if (vec3.length(toTarget) <= d.physicsCone.radius + e.physicsCone.radius) {
          var eVel = u.vecify(e.physics.vel)
          var dVel = u.vecify(d.physics.vel)
          vec3.scale(eVel, eVel, e.physics.mass)
          vec3.scale(dVel, dVel, d.physics.mass)
          var resVel = vec3.create()
          vec3.add(resVel, eVel, dVel)
          // d.physics.vel.x += resVel[0] / d.physics.mass
          // d.physics.vel.z += resVel[0] / d.physics.mass
          // e.physics.vel.x += -resVel[0] / e.physics.mass
          // e.physics.vel.z += -resVel[0] / e.physics.mass

          var eMomentum = vec3.length(eVel) * e.physics.mass
          var dMomentum = vec3.length(dVel) * d.physics.mass
          var res = vec3.length(resVel) / e.physics.mass

          vec3.normalize(toTarget, toTarget)
          // var massDiff = d.physics.mass / e.physics.mass
          // vec3.scale(toTarget, toTarget, 0.003 * massDiff)
          var dot = (1 - vec3.dot(toTarget, eVel)) * 0.5
          vec3.scale(toTarget, toTarget, 0.5 * res)
          e.physics.vel.x += toTarget[0] * dot
          e.physics.vel.z += toTarget[2] * dot
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
    player.addComponent(TextHolder)
    player.addComponent(Player)
    player.addComponent(Physics, 50)
    player.addComponent(PhysicsCone, 1.5)
    player.addComponent(CameraController)
    player.addComponent(Health, 30)
    player.addComponent(Mana, 12)
    player.addComponent(Inventory)
    player.addComponent(Level)
    player.addTag('player')
    player.textHolder.scale = 0.2
    player.on('death', function () {
      player.physics.height = 0.5
      player.physics.vel.y = 1
      player.physics.pos.y += 1
      camera.rot[2] = Math.PI/7
      camera.rot[0] = -Math.PI/5
      console.log('you are remarkably dead')
    })
    player.on('level-up', function () {
      spawnParticleLevelUp(u.vecify(player.physics.pos))
      player.health.max = Math.floor(player.health.max * 1.1)
      player.health.amount = player.health.max
      player.mana.max = Math.floor(player.mana.max * 1.1)
      player.mana.amount = player.mana.max
      // TODO: increase melee damage?
      notify('    Welcome to Level ' + player.level.level + '    ')
    })
    player.on('pickup-item', function (i) {
      guiInventory.addItem(i.id, i.billboardSprite.sprite)
    })
    player.on('drop-item', function (i) {
      if (inventorySelected === player.inventory.contents.indexOf(i)) {
        i.item.lexicon.forEach(function (word) {
          player.player.lexicon.splice(player.player.lexicon.indexOf(word), 1)
          guiLexicon.removeWord(word)
        })
        inventorySelected = null
      }
      guiInventory.removeItem(i.id)
    })
    player.on('select-item', function (idx) {
      // deselect previous item
      if (inventorySelected !== null) {
        var item = player.inventory.contents[inventorySelected].item
        item.lexicon.forEach(function (word) {
          player.player.lexicon.splice(player.player.lexicon.indexOf(word), 1)
          guiLexicon.removeWord(word)
        })
      }

      guiInventory.selectItem(idx)

      if (idx-1 === inventorySelected) {
        inventorySelected = null
        return
      }

      // select new item
      inventorySelected = idx-1
      player.inventory.contents[idx-1].item.lexicon.forEach(function (word) {
        player.player.lexicon.push(word)
        guiLexicon.addWord(word, [0,1,0,1])
      })
    })
  }

  // alloc + config map
  map = new Voxel(regl, 50, 10, 50, texture['atlas.png'], 16, 16)
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

  function createPotion (x, y, z) {
    var potion = world.createEntity()
    var id = Math.floor(Math.random() * 24)
    potion.addComponent(BillboardSprite, sprite('potion/potion_' + id), [1,1])
    potion.billboardSprite.scale = 0.5
    potion.addComponent(Physics, 5)
    potion.addComponent(Item)
    potion.addComponent(PhysicsCone, 0.5)
    potion.addComponent(Identity, 'potion')
    potion.addComponent(TextHolder)
    potion.addComponent(Potion)
    potion.item.lexicon = ['THROW', 'QUAFF']
    potion.physics.height = 3
    potion.physics.friction = 0.9
    potion.physics.pos.x = x
    potion.physics.pos.y = y
    potion.physics.pos.z = z
    return potion
  }

  function createApple (x, y, z) {
    var apple = world.createEntity()
    apple.addComponent(BillboardSprite, sprite('food/apple'), [1,1])
    apple.billboardSprite.scale = 0.5
    apple.addComponent(Physics, 5)
    apple.addComponent(Item)
    apple.addComponent(PhysicsCone, 0.5)
    apple.addComponent(Identity, 'apple')
    apple.addComponent(TextHolder)
    apple.addComponent(Food, 5)
    apple.item.lexicon = ['THROW', 'EAT']
    apple.physics.height = 3
    apple.physics.friction = 0.9
    apple.physics.pos.x = x
    apple.physics.pos.y = y
    apple.physics.pos.z = z
    return apple
  }

  createApple(player.physics.pos.x,
              player.physics.pos.y + 2,
              player.physics.pos.z + 2)
  createPotion(player.physics.pos.x + 1,
               player.physics.pos.y + 2,
               player.physics.pos.z + 2)

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
      foe.addComponent(Physics, 30)
      foe.addComponent(BillboardSprite, sprite('foe/foe'))
      foe.addComponent(MobAI)
      foe.addComponent(PhysicsCone, 1.5)
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
      door.addComponent(Physics, 1000)
      door.addComponent(Door)
      door.addComponent(PhysicsCone, 2)
      door.door.rot = rot
      door.addComponent(BillboardSprite, sprite('door/door'))
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
            var br = u.pointLight(lightPos, light.intensity, pos, normal)
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
    var x = 16
    var player = world.queryTag('player')[0]
    player.player.lexicon.forEach(function (word) {
      guiLexicon.addWord(word)
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

  var drawSky = Sky(regl)
  var drawMeter = Meter(regl)
  var drawParticles = ParticleSystem(regl)
  var drawBillboard = Billboard(regl)

  function drawBillboardEntity (e) {
    if (!e.billboardSprite.sprite) return
    if (!e.billboardSprite.sprite.texture) return
    var at = u.vecify(e.physics.pos)
    var scale = e.billboardSprite.scale
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, at)
    mat4.scale(model, model, vec3.fromValues(scale, scale, scale))
    var rot = -Math.atan2(-camera.pos[2] - at[2], -camera.pos[0] - at[0]) + Math.PI/2
    mat4.rotateY(model, model, rot)
    drawBillboard({
      model: model,
      view: view,
      projection: projectionWorld,
      texture: e.billboardSprite.sprite.texture.data,
      uvs: e.billboardSprite.sprite.uvs[e.billboardSprite.frameX]
    })
  }

  function drawSprite (e, x, y) {
    if (!e.billboardSprite.sprite) return
    if (!e.billboardSprite.sprite.texture) return
    var at = vec3.fromValues(x, y, -0.2)
    var scale = 25
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, at)
    mat4.scale(model, model, vec3.fromValues(scale, -scale, scale))
    drawBillboard({
      model: model,
      view: mat4.create(),
      projection: projectionScreen,
      texture: e.billboardSprite.sprite.texture.data,
      uvs: e.billboardSprite.sprite.uvs[e.billboardSprite.frameX]
    })
  }

  function drawText2D (text, x, y, scale) {
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, vec3.fromValues(x, y, -0.2))
    mat4.scale(model, model, vec3.fromValues(scale * 25, scale * 25, scale * 25))
    text({
      projection: projectionScreen,
      view: mat4.create(),
      model: model
    })
  }

  function drawText (text, x, y, z, scale) {
    scale = scale || 1
    var model = mat4.create()
    mat4.identity(model)
    mat4.translate(model, model, vec3.fromValues(x, y, z))
    mat4.scale(model, model, vec3.fromValues(scale, -scale, scale))
    var rot = -Math.atan2(-camera.pos[2] - z, -camera.pos[0] - x) + Math.PI/2
    mat4.rotateY(model, model, rot)
    text({
      projection: projectionWorld,
      view: view,
      model: model
    })
  }

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

    projectionWorld = mat4.perspective([],
                                       Math.PI / 3,
                                       state.viewportWidth / state.viewportHeight,
                                       0.01, 1000)
    projectionScreen = mat4.ortho(mat4.create(),
                                  0, screenWidth,
                                  screenHeight, 0,
                                  -1, 1)

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
    drawSky()

    // Draw voxel world
    map.draw({
      projection: projectionWorld,
      view: view
    })

    // Player logic
    world.queryComponents([Player]).forEach(function (e) {
      e.player.update()
    })

    // Draw text over targets
    world.queryComponents([Physics, TextHolder]).forEach(function (e) {
      if (e.textHolder.draw) {
        if (e.player) {
          var x = e.physics.pos.x + Math.sin(camera.rot[1]) * 1.5
          var y = e.physics.pos.y + 0.6
          var z = e.physics.pos.z - Math.cos(camera.rot[1]) * 1.5
          drawText(e.textHolder.draw, x, y, z, e.textHolder.scale)
        } else {
          drawText(e.textHolder.draw, e.physics.pos.x, e.physics.pos.y + 1.5, e.physics.pos.z, e.textHolder.scale)
        }
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
        if (m.player && !/[A-Z]/.test(e.text3D.text[0])) return
        if (m.textHolder.locked) {
          e.remove()
          done = true
          return
        }
        var dx = m.physics.pos.x - e.physics.pos.x
        var dz = m.physics.pos.z - e.physics.pos.z
        var dist = Math.sqrt(dx*dx + dz*dz)
        if (dist < m.physics.width/2) {
          m.textHolder.add(e.text3D.text)
          e.remove()
          done = true

          var plr = world.queryTag('player')[0]
          var res = checkLexicon(plr, m, m.textHolder.text)
          if (res) {
            if (typeof res === 'function') {
              m.textHolder.locked = true
            }
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
              }, 200)
            }
          }
        }
      })
    })

    var plr = world.queryTag('player')[0]

    // Draw billboard sprites
    var bills = world.queryComponents([BillboardSprite, Physics])
    bills.sort(u.distCmp.bind(null, plr))
    bills.forEach(function (e) {
      if (e.billboardSprite.visible) drawBillboardEntity(e)
    })

    // hp meter
    var hp = plr.health.amount / plr.health.max
    var hpDanger = (1 - hp) * 0.4
    drawMeter({
      at: [0.75, 0.8],
      segs: Math.floor(plr.health.amount * 0.5),
      maxSegs: Math.floor(plr.health.max * 0.5),
      tick: state.tick,
      danger: hpDanger,
      color: [1, 0, 0, 0.75],
    })
    // mp meter
    var mp = plr.mana.amount / plr.mana.max
    var mpDanger = (1 - mp) * 0.4
    drawMeter({
      at: [0.83, 0.8],
      segs: Math.floor(plr.mana.amount * 0.5),
      maxSegs: Math.floor(plr.mana.max * 0.5),
      tick: state.tick,
      danger: mpDanger,
      color: [0, 0, 1, 0.75]
    })
    // xp meter
    var xp = plr.level.xp / plr.level.xpNext
    drawMeter({
      at: [0.91, 0.8],
      segs: Math.floor(xp * 25),
      maxSegs: 25,
      tick: state.tick,
      danger: 0.0,
      color: [0, 0.65, 0, 0.5]
    })

    // GUI text
    world.queryComponents([Text2D]).forEach(function (e) {
      drawText2D(e.text2D.draw, e.text2D.x, e.text2D.y, e.text2D.scale)
    })

    // Draw particle effects
    world.queryComponents([ParticleEffect]).forEach(function (e) {
      var commands = e.particleEffect.data.map(function (d) {
        return {
          projection: projectionWorld,
          view: view,
          model: d.mat,
          color: e.particleEffect.color
        }
      })
      drawParticles(commands)
    })

    guiLexicon.draw(projectionScreen)

    guiInventory.draw(projectionScreen, screenHeight)

    // Draw inventory icons
    world.queryComponents([BillboardSprite, Sprite2D]).forEach(function (e) {
      drawSprite(e, e.sprite2D.x, e.sprite2D.y)
    })
  })
}
