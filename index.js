const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Socket } = require('dgram');
const { name } = require('ejs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静态文件
app.use(express.static('public'));
app.set('view engine', 'ejs');

// 路由
app.get('/', (req, res) => {
  res.render('index');
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.get('/game', (req, res) => {
  res.render('game');
});

app.get('/report.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'report.html'));
});

let players = [];
let currentPlayerIndex = 0;
let grid = Array(16).fill(null);
let pool = [];
let scores = {};

const shape = ['circle', 'sqaure', 'star','triangle'];
const color = ['red', 'blue', 'yellow', 'green'];

function initPool(){
  pool = [];
  for (let s of shape){
    for (let c of color){
      pool.push({shape: s, color: c});
    }
  }
}

initPool();

io.on('connection', (socket) => {
  console.log('Player connection: ', socket.id);

  socket.on('join', (socket) => {
    if (!players.some( p => p.id === socket.id)) {
      players.push({id: socket.id, name: name});
    scores[name] = 0;
    io.emit('playLists', players);
    io.emit('scoreUpdate', scores);
    }
  })
})

// 启动
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});