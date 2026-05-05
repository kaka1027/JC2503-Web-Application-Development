const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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

// 用于存储每个socket对应的玩家数组
const socketPlayers = new Map();

// 用于记录每个socket当前活跃的玩家索引
const activePlayerIndexMap = new Map();

let players = [];
let currentPlayerIndex = 0;
let grid = Array(16).fill(null);
let pool = [];
let scores = {};

const shape = ['circle', 'square', 'star','triangle'];
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
    const playerName = data.name || `Player_${socket.id.substring(0, 4)}`;

    // 如果这个socket还没有玩家数组，初始化
    if (!socketPlayers.has(socket.id)) {
      socketPlayers.set(socket.id, []);
      activePlayerIndexMap.set(socket.id, 0);
    }

    const playersArray = socketPlayers.get(socket.id);

    // 生成唯一玩家ID：socket.id + 下标
    const uniquePlayerId = `${socket.id}_${playersArray.length}`;

    // 添加新玩家到该socket的玩家数组
    playersArray.push({
      id: uniquePlayerId,
      name: playerName
    });

    // 更新全局players数组（保持兼容）
    players.push({
      id: uniquePlayerId,
      name: playerName
    });

    // 初始化分数
    scores[uniquePlayerId] = { name: playerName, score: 0 };

    console.log('玩家加入，当前分数表：', scores);
    console.log('socketPlayers:', socketPlayers);

    io.emit('playLists', players);
    io.emit('scoreUpdate', scores);

    // 游戏开始后新玩家也可以加入
    if (gameStarted) {
      socket.emit('gridUpdate', grid);
    }
  })

  socket.on('placeBlock', (data) => {
    handlePlacement(socket.id, data.index, data.block);
  })

  socket.on('startGame', () => {
    if (!gameStarted && players.length > 0) {
      gameStarted = true;
      io.emit('gameStarted');
      startNewTurn();
    }
  });

  socket.on('disconnect', () => {
    // 获取该socket下的所有玩家
    const playersArray = socketPlayers.get(socket.id);

    if (playersArray) {
      // 从全局players数组中移除该socket的所有玩家
      players = players.filter(p => !p.id.startsWith(socket.id));

      // 从scores中移除该socket的所有玩家
      playersArray.forEach(player => {
        delete scores[player.id];
      });

      // 从Map中移除该socket
      socketPlayers.delete(socket.id);
      activePlayerIndexMap.delete(socket.id);
    }

    console.log('玩家断线，当前分数表：', scores);

    io.emit('playLists', players);
    io.emit('scoreUpdate', scores);

    if (players.length === 0) {
      resetGame();
    } else if (gameStarted) {
      // 如果游戏已开始且还有玩家，继续下一回合
      currentPlayerIndex = currentPlayerIndex % players.length;
      startNewTurn();
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
    activePlayerName: currentPlayer.name,
    block: currentBlock,
    nextIndex: currentPlayerIndex
  });

  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => {
    skipTurn();
  }, 60000);
}

function skipTurn() {
  if (players.length === 0) return;

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;
  io.emit('message', 'Turn skipped due to timeout');
  startNewTurn();
}

function handlePlacement(socketId, index, block) {
  const currentPlayer = players[currentPlayerIndex];
  if (!currentPlayer) return;

  // 检查当前玩家是否属于这个socket
  if (!currentPlayer.id.startsWith(socketId)) return;

  if (grid[index] != null) return;

  clearTimeout(turnTimer);

  grid[index] = block;

  let pointsEarned = checkGameRules(index);
  if (pointsEarned > 0) {
    scores[currentPlayer.id].score += pointsEarned;
  }

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

  const row = Math.floor(lastPos / 4);
  const col = lastPos % 4;
  const target = grid[lastPos];

  // 检查横向（同一行）
  checkLine(row * 4, 1, 4, target, blocksToRemove);

  // 检查纵向（同一列）
  checkLine(col, 4, 4, target, blocksToRemove);

  // 检查主对角线（左上到右下）
  if (row === col) {
    checkLine(0, 5, 4, target, blocksToRemove);
  }

  // 检查副对角线（右上到左下）
  if (row + col === 3) {
    checkLine(3, 3, 4, target, blocksToRemove);
  }

  blocksToRemove.forEach(idx => {
    pool.push(grid[idx]);
    grid[idx] = null;
    earned += 1;
  });

  return earned;
}

function checkLine(start, step, count, target, blocksToRemove) {
  let sameColor = [];
  let sameShape = [];

  for (let i = 0; i < count; i++) {
    const idx = start + i * step;
    const cell = grid[idx];

    if (cell) {
      if (cell.color === target.color) {
        sameColor.push(idx);
      } else {
        sameColor = [];
      }

      if (cell.shape === target.shape) {
        sameShape.push(idx);
      } else {
        sameShape = [];
      }

      if (sameColor.length === 4) {
        sameColor.forEach(i => blocksToRemove.add(i));
      }

      if (sameShape.length === 4) {
        sameShape.forEach(i => blocksToRemove.add(i));
      }
    } else {
      sameColor = [];
      sameShape = [];
    }
  }
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