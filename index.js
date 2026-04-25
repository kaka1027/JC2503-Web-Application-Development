const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { Socket } = require('dgram');
const { name } = require('ejs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// static file
app.use(express.static('public'));
app.set('view engine', 'ejs');

// protocol
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

let gameStarted = false;

io.on('connection', (socket) => {
  console.log('Player connection: ', socket.id);

  socket.on('join', (data) => {
    const playerName = data.name || 'Player_${socket.id.substring(0, 4)';

    if (!players.some( p => p.id === socket.id)) {
      players.push({id: socket.id, name: playerName});
      scores[socket.id] = 0;

      io.emit('playLists', players);
      io.emit('scoreUpdate', scores);

      if (players.length == 1 && !gameStarted) {
        gameStarted = true;
        startNewTurn();
      } else {
        //synchronize the current puzzle to other new players.
        socket.emit('gameState', { grid, currentPlayerIndex });
      }
    }
  })

  socket.on('placeBlock', (index) => {
    handlePlacement(socket.id, index);
  })

  socket.on('disconnect', () => {
    players = players.filter( p => p.id !== socket.id);
    delete scores[socket.id];
    io.emit('playLists', players);

    if (players.length === 0) {
      resetGame();
    }
  });
});

let currentBlock = null;
let turnTimer = null;

function startNewTurn() {
  if (players.length === 0) return;
  if (pool.length === 0) initPool();

  const randomIndex = Math.floor(Math.random() * pool.length);
  currentBlock = pool.splice(randomIndex, 1)[0];

  const currentPlayer = players[currentPlayerIndex];
  io.emit('newTurn', {
    activePlayerId: currentPlayer.id,
    block: currentBlock,
    nextIndex: currentPlayerIndex
  });

  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => {
    skipTurn();
  }, 60000);
}

function handlePlacement(socketId, index) {
  const currentPlayer = players[currentPlayerIndex];
  if (!currentPlayer || socketId !== currentPlayer.id) return;
  if (grid[index] != null) return;

  clearTimeout(turnTimer);

  let pointsEarned = checkGameRules(index);
  scores[socketId] += pointsEarned;

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;

  io.emit('gridUpdate', grid);
  io.emit('scoreUpdate', scores);

  startNewTurn();
}

function checkGameRules(lastPos) {
  let earned = 0;
  let blocksToRemove = new Set();

  const isFull = grid.every(cell => cell != null);
  if (isFull) {
    grid.fill(null);
    initPool();
    return 16;
  }

  const directions = [1,4,5,3];
  const row = Math.floor(lastPos / 4);
  const col = lastPos % 4;

  const target = grid[lastPos];

  blocksToRemove.forEach(idx => {
    pool.push(grid[idx]);
    grid[idx] = null;
    earned += 1;
  });

  return earned;
}

function resetGame() {
  grid.fill(null);
  initPool();
  currentPlayerIndex = 0;
  gameStarted = false;
}


// 启动
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});