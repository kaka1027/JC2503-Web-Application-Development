const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.set('view engine', 'ejs');

app.get('/', (req, res) => res.render('index'));
app.get('/about', (req, res) => res.render('about'));
app.get('/game', (req, res) => res.render('game'));
app.get('/report.html', (req, res) => res.sendFile(path.join(__dirname, 'report.html')));

// socketId -> [playerId1, playerId2, ...]
const socketPlayerMap = new Map();

let players = [];
let currentPlayerIndex = 0;
let grid = Array(16).fill(null);
let pool = [];
let scores = {};
let currentBlock = null;
let turnTimer = null;
let nextPlayerId = 1;

const shapes = ['circle', 'square', 'star', 'triangle'];
const colors = ['red', 'blue', 'yellow', 'green'];

function initPool() {
  pool = [];
  for (let s of shapes) {
    for (let c of colors) {
      pool.push({ shape: s, color: c });
    }
  }
}

initPool();

// ─── player management ───────────────────────────────────────────────

function removePlayer(playerId) {
  const idx = players.findIndex(p => p.id === playerId);
  if (idx === -1) return;

  const isCurrentTurn = (idx === currentPlayerIndex);

  players.splice(idx, 1);
  delete scores[playerId];

  console.log(`Player removed: ${playerId}. Remaining: ${players.length}`);

  io.emit('playLists', players);
  io.emit('scoreUpdate', scores);

  if (players.length === 0) {
    // no players left — reset state but game is always "running"
    clearTimeout(turnTimer);
    grid.fill(null);
    initPool();
    currentPlayerIndex = 0;
    currentBlock = null;
    return;
  }

  // adjust index after removal
  if (idx < currentPlayerIndex) {
    currentPlayerIndex--;
  } else if (isCurrentTurn) {
    if (currentPlayerIndex >= players.length) {
      currentPlayerIndex = 0;
    }
    clearTimeout(turnTimer);
    startNewTurn();
    return;
  }
}

// ─── socket events ───────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join', (data) => {
    const playerName = data.name || `Player_${nextPlayerId}`;

    console.log(`Join attempt: "${playerName}"`);
    console.log('Current players:', players.map(p => p.name));

    // Check if name already exists in active players
    const nameExists = players.some(p => p.name === playerName);
    if (nameExists) {
      console.log(`Join rejected: Name "${playerName}" already exists`);
      socket.emit('joinError', { message: 'This name is already taken. Please choose a different name.' });
      return;
    }

    const playerId = `player_${nextPlayerId++}`;

    // track which socket owns this player
    if (!socketPlayerMap.has(socket.id)) {
      socketPlayerMap.set(socket.id, []);
    }
    socketPlayerMap.get(socket.id).push(playerId);

    players.push({ id: playerId, name: playerName, socketId: socket.id });
    scores[playerId] = { name: playerName, score: 0 };

    console.log('Player joined:', playerName, 'ID:', playerId);

    // tell this socket their new playerId
    socket.emit('joinSuccess', { playerId, playerName });

    io.emit('playLists', players);
    io.emit('scoreUpdate', scores);

    // always send current grid so new player sees the board
    socket.emit('gridUpdate', grid);
    socket.emit('gameStarted');

    if (players.length === 1) {
      // first player — start the game
      startNewTurn();
    } else {
      // game already running — tell the new player whose turn it currently is
      const currentPlayer = players[currentPlayerIndex];
      const isNewPlayerTurn = socket.id === currentPlayer.socketId;
      socket.emit('newTurn', {
        activePlayerId: currentPlayer.id,
        activePlayerName: currentPlayer.name,
        block: isNewPlayerTurn ? currentBlock : null,
        isYourTurn: isNewPlayerTurn
      });
    }
  });

  socket.on('placeBlock', (data) => {
    handlePlacement(data.playerId, data.index);
  });

  socket.on('quitGame', (data) => {
    const playerId = data.playerId;
    if (!playerId) return;

    const playerIds = socketPlayerMap.get(socket.id);
    if (!playerIds || !playerIds.includes(playerId)) return;

    // remove from socket's player list
    const idx = playerIds.indexOf(playerId);
    playerIds.splice(idx, 1);
    if (playerIds.length === 0) {
      socketPlayerMap.delete(socket.id);
    }

    removePlayer(playerId);
    socket.emit('playerQuit', { playerId });
    console.log(`Player quit: ${playerId}`);
  });

  socket.on('disconnect', () => {
    const playerIds = socketPlayerMap.get(socket.id);
    if (!playerIds) return;

    socketPlayerMap.delete(socket.id);

    // remove all players owned by this socket
    playerIds.forEach(playerId => {
      removePlayer(playerId);
      console.log(`Player disconnected: ${playerId}`);
    });
  });
});

// ─── turn logic ──────────────────────────────────────────────────────

function startNewTurn() {
  if (players.length === 0) return;

  if (pool.length === 0) {
    console.log('Pool is empty, reinitialising');
    initPool();
  }

  const randomIndex = Math.floor(Math.random() * pool.length);
  currentBlock = pool.splice(randomIndex, 1)[0];

  const currentPlayer = players[currentPlayerIndex];
  console.log(`New turn: ${currentPlayer.name}, pool remaining: ${pool.length}`);

  // send turn info to everyone — block details only to the active player's socket
  io.sockets.sockets.forEach((s) => {
    const isActive = s.id === currentPlayer.socketId;
    s.emit('newTurn', {
      activePlayerId: currentPlayer.id,
      activePlayerName: currentPlayer.name,
      block: isActive ? currentBlock : null,
      isYourTurn: isActive
    });
  });

  clearTimeout(turnTimer);
  turnTimer = setTimeout(() => timeoutPlayer(), 60000);
}

function timeoutPlayer() {
  if (players.length === 0) return;

  const timedOutPlayer = players[currentPlayerIndex];
  console.log(`Player timed out: ${timedOutPlayer.name}`);

  io.emit('message', `${timedOutPlayer.name} was removed due to inactivity.`);

  // find and remove from socketPlayerMap
  for (const [sid, playerIds] of socketPlayerMap.entries()) {
    const idx = playerIds.indexOf(timedOutPlayer.id);
    if (idx !== -1) {
      playerIds.splice(idx, 1);
      if (playerIds.length === 0) {
        socketPlayerMap.delete(sid);
      }
      break;
    }
  }

  removePlayer(timedOutPlayer.id);
}

function handlePlacement(playerId, index) {
  const currentPlayer = players[currentPlayerIndex];
  if (!currentPlayer) return;
  if (currentPlayer.id !== playerId) return;

  if (grid[index] != null) {
    // Send error message to the player who tried to place in occupied cell
    const socket = io.sockets.sockets.get(currentPlayer.socketId);
    if (socket) {
      socket.emit('placementError', { message: 'This cell is already occupied! Please choose an empty cell.' });
    }
    return;
  }

  if (!currentBlock) return;

  clearTimeout(turnTimer);

  grid[index] = currentBlock;

  const pointsEarned = checkGameRules(index);
  if (pointsEarned > 0) {
    scores[currentPlayer.id].score += pointsEarned;
  }

  currentPlayerIndex = (currentPlayerIndex + 1) % players.length;

  io.emit('gridUpdate', grid);
  io.emit('scoreUpdate', scores);

  startNewTurn();
}

// ─── game rules ──────────────────────────────────────────────────────

function checkGameRules(lastPos) {
  // jackpot: board is full
  const isFull = grid.every(cell => cell != null);
  if (isFull) {
    grid.fill(null);
    initPool();
    io.emit('gridUpdate', grid);
    return 16;
  }

  const blocksToRemove = new Set();
  const row = Math.floor(lastPos / 4);
  const col = lastPos % 4;
  const target = grid[lastPos];

  // check horizontal (same row)
  checkLine(row * 4, 1, 4, target, blocksToRemove);
  // check vertical (same column)
  checkLine(col, 4, 4, target, blocksToRemove);
  // check main diagonal (top-left to bottom-right)
  if (row === col) checkLine(0, 5, 4, target, blocksToRemove);
  // check anti-diagonal (top-right to bottom-left)
  if (row + col === 3) checkLine(3, 3, 4, target, blocksToRemove);

  let earned = 0;
  blocksToRemove.forEach(idx => {
    pool.push(grid[idx]);
    grid[idx] = null;
    earned++;
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

      // trigger on 3 or more consecutive matches
      if (sameColor.length >= 3) {
        sameColor.forEach(i => blocksToRemove.add(i));
      }
      if (sameShape.length >= 3) {
        sameShape.forEach(i => blocksToRemove.add(i));
      }
    } else {
      sameColor = [];
      sameShape = [];
    }
  }
}

// ─── start server ────────────────────────────────────────────────────

const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
