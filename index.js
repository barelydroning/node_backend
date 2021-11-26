const app = require('express')()
const http = require('http').Server(app)
const io = require('socket.io')(http)
const winston = require('winston')

const logger = new (winston.Logger)({
  transports: [
    new (winston.transports.File)({ filename: 'drone.log' })
  ]
})

let drones = []
let clients = []
let droneData = []
let rovers = []

let record = false

const RAD_CUTOFF = 0.1
const WOBBLE_THRESHOLD = 5

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/index.html')
})

app.get('/drones', function (req, res) {
  res.json(drones)
})

app.get('/rovers', function (req, res) {
  res.json(rovers)
})

const tellClients = (socket, command, message) => {
  clients.forEach(client => {
    socket.broadcast.to(client).emit(command, message)
  })
}

io.on('connection', function (socket) {
  console.log('a user connected', socket.id)
  socket.emit('socket_id', socket.id)

  socket.on('connect_drone', function () {
    if (!drones.includes(socket.id)) {
      drones.push(socket.id)
      tellClients(socket, 'connected_drones', drones)
      socket.emit('connected_drones', drones)
    }
  })

  socket.on('connect_rover', function () {
    if (!rovers.includes(socket.id)) {
      rovers.push(socket.id)
      tellClients(socket, 'connected_rovers', rovers)
      socket.emit('connected_rovers', rovers)
    }
  })

  socket.on('rover_data', function(data) {
    data.rover = socket.id
    tellClients(socket, 'rover_data', data)
  })

  socket.on('record', function (recording) {
    record = recording
  })

  socket.on('connect_client', function () {
    !clients.includes(socket.id) && clients.push(socket.id)
    socket.emit('connected_drones', drones)
    socket.emit('connected_rovers', rovers)
  })

  socket.on('robot_command', function (robot, command) {
    socket.broadcast.to(robot).emit('command', JSON.parse(command))
    console.log('Command to robot ' + robot + ': ' + command)
  })

  socket.on('tune', function (drone) {
    droneData.push({ drone, data: [] })

    let P = 160
    let I = 0
    let D = 0
    const pid_type = 'pitch'
    const P_INCREMENT = 10
    const D_INCREMENT = 10
    const I_INCREMENT = 10
    const STD_THRESHOLD = 0.01

    const I_EPSILON = 0.1

    let data
    let pitch
    let roll
    let azimuth

    let status = 'tuneD'

    socket.broadcast.to(drone).emit('command', { P, I, D, type: 'pid', pid_type })

    const intervalId = setInterval(() => {
      data = getDrone(drone).data
      pitch = data.map(({ pitch }) => pitch)

      if (status === 'tuneP') {
        console.log('tuning P, value is', P)
        // roll = data.map(({roll}) => roll)
        // azimuth = data.map(({azimuth}) => azimuth)

        let countWobble = 0
        let prevSide = null

        pitch.forEach(value => {
          if (value > RAD_CUTOFF || value < -RAD_CUTOFF) {
            const side = value < 0 ? 'left' : 'right'
            if (prevSide === null || prevSide !== side) {
              prevSide = side
              countWobble++
              console.log('counting one wobble')
            }
          }
        })

        console.log('wobble count is', countWobble)

        if (countWobble >= WOBBLE_THRESHOLD) {
          const oldP = P
          P = Math.floor(P * 0.8)
          console.log('final P IS', P, 'tuned P is', oldP)

          status = 'tuneD'
        }

        P += P_INCREMENT
      } else if (status === 'tuneD') {
        console.log('tuning D, value is', D)
        const mean = pitch.reduce((a, b) => a + b, 0) / pitch.length
        const stdDev = pitch.map(value => (value - mean) * (value - mean)).reduce((a, b) => a + b, 0) / (pitch.length - 1)

        console.log('D tune, mean is', mean, 'std is', stdDev)

        if (stdDev <= STD_THRESHOLD) {
          console.log('D IS', D)
          status = 'tuneI'
        }

        D += D_INCREMENT
      } else if (status === 'tuneI') {
        console.log('tuning I, value is', I)
        const mean = pitch.reduce((a, b) => a + b, 0) / pitch.length

        console.log('I tune, mean is', mean)

        if (Math.abs(mean) <= I_EPSILON) {
          console.log('I IS', I)
          clearInterval(intervalId)
        }

        I += I_INCREMENT
      }

      getDrone(drone).data = []

      socket.broadcast.to(drone).emit('command', { P, I, D, type: 'pid', pid_type })
    }, 5000)
  })

  const getDrone = droneId => droneData.find(({ drone }) => drone === droneId)

  socket.on('drone_data', function (data) {
    record && logger.info(data)
    getDrone(data.drone) && getDrone(data.drone).data.push(data)
    tellClients(socket, 'drone_data', data)
  })

  socket.on('disconnect', function () {
    const id = socket.id
    drones = drones.includes(id) ? drones.filter(drone => drone !== id) : drones
    clients = clients.includes(id) ? clients.filter(client => client !== id) : clients
    rovers = rovers.includes(id) ? rovers.filter(rover => rover !== id) : rovers
    clients.forEach(client => {
      socket.broadcast.to(client).emit('connected_drones', drones)
      socket.broadcast.to(client).emit('connected_rovers', rovers)
    })
    console.log('user disconnected')
  })
})

http.listen(3001, function () {
  console.log('listening on *:3001')
})
