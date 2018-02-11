const app = require('express')()
const http = require('http').Server(app)
const io = require('socket.io')(http)

let drones = []
let clients = []
let droneData = []

const RAD_CUTOFF = 0.5
const WOBBLE_THRESHOLD = 10

app.get('/', function(req, res){
  res.sendFile(__dirname + '/index.html')
})

app.get('/drones', function(req, res) {
  res.json(drones)
})

const tellClients = (socket, command, message) => {
  clients.forEach(client => {
    socket.broadcast.to(client).emit(command, message)
  })
}

io.on('connection', function(socket){
  console.log('a user connected', socket.id)
  socket.emit('socket_id', socket.id)

  socket.on('connect_drone', function() {
    if (!drones.includes(socket.id)) {
      drones.push(socket.id)
      tellClients(socket, 'connected_drones', drones)
      socket.emit('connected_drones', drones)
    }
  })

  socket.on('connect_client', function() {
    !clients.includes(socket.id) && clients.push(socket.id)
    socket.emit('connected_drones', drones)
  })

  socket.on('drone_command', function(drone, command) {
    socket.broadcast.to(drone).emit('command', JSON.parse(command))
    console.log('Command to drone ' + drone + ': ' + command)
  })

  socket.on('tune', function(drone) {
    droneData.push({drone, data: []})
    
    let P = 10
    let I = 0
    let D = 0
    const pid_type = 'pitch'
    const P_INCREMENT = 10
    const D_INCREMENT = 10
    const I_INCREMENT = 10
    const STD_THRESHOLD = 0.2

    const I_EPSILON = 0.1
    
    let data
    let pitch
    let roll
    let azimuth

    let status = 'tuneP'

    const intervalId = setInterval(() => {
      data = getDrone(drone).data

      if (status === 'tuneP') {
        pitch = data.map(({pitch}) => pitch)
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
            }
          }
        })
  
        if (countWobble >= WOBBLE_THRESHOLD) {
          console.log('P IS', P)
          // clearInterval(intervalId)
          status = 'tuneD'
        }
  
  
        P += P_INCREMENT
  
      } else if (status === 'tuneD') {
        const mean = pitch.reduce((a,b) =>a+b , 0) / pitch.length
        const stdDev = pitch.map(value => (value-mean)*(value-mean)).reduce((a,b) => a+b, 0) / (pitch.length-1)

        if (stdDev >= STD_THRESHOLD) {
          console.log('D IS', D)
          status = 'tuneI'
        }

        D += D_INCREMENT

      } else if (status === 'tuneI') {
        const mean = pitch.reduce((a,b) =>a+b , 0) / pitch.length

        if (Math.abs(mean) >= I_EPSILON) {
          console.log('I IS', I)
          clearInterval(intervalId)
        }
      }

      getDrone(drone).data = []
      

      socket.broadcast.to(drone).emit('command', {P, I, D, type: 'pid', pid_type})
    }, 5000)
  })

  const getDrone = droneId => droneData.find(({drone}) => drone === droneId)

  socket.on('drone_data', function(data) {
    getDrone(data.drone) && getDrone(data.drone).data.push(data)
    tellClients(socket, 'drone_data', data)
  })

  socket.on('disconnect', function(){
    const id = socket.id
    drones = drones.includes(id) ? drones.filter(drone => drone !== id) : drones
    clients = clients.includes(id) ? clients.filter(client => client !== id) : clients
    clients.forEach(client => {
      socket.broadcast.to(client).emit('connected_drones', drones)
    })
    console.log('user disconnected')
    
  });
});

http.listen(3001, function(){
  console.log('listening on *:3001')
})