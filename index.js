const app = require('express')()
const http = require('http').Server(app)
const io = require('socket.io')(http)

let drones = []
let clients = []

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
    socket.broadcast.to(drone).emit('command', {command})
    console.log('Command to drone ' + drone + ': ' + command)
  })

  socket.on('test', function(one, two, three) {
    console.log('testi festi', one, two, three)
  })

  socket.on('drone_data', function(data) {
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