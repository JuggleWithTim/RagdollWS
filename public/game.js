const socket = io();
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
canvas.style.display = 'none';

const USE_TWITCH_LOGIN = true; // Set to false to allow manual username selection

// Hide/show buttons based on Twitch login
window.addEventListener('DOMContentLoaded', () => {
  if (USE_TWITCH_LOGIN) {
    document.getElementById('username').style.display = 'none';
    document.getElementById('join-btn').style.display = 'none';
    document.getElementById('twitch-login-btn').style.display = '';
  } else {
    document.getElementById('username').style.display = '';
    document.getElementById('join-btn').style.display = '';
    document.getElementById('twitch-login-btn').style.display = 'none';
  }
});

let gameState = 'waiting';
let allPlayers = {};
let simState = {};
let hpState = {};
let bloodParticles = [];
let spectator = false;
let animationFrameId = null;
let lobbyOverlayText = '';

let gotSocketId = false;
let pendingGameState = null;

let roundEndsAt = null;

function stopAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"]|'/g, function (s) {
    return ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[s];
  });
}

function updateLobbyOverlay() {
  if (spectator && (gameState === 'running' || gameState === 'countdown')) {
    lobbyOverlayText = 'Game in progress, please wait';
  } else if (gameState === 'waiting') {
    if (Object.keys(allPlayers).length < 2) {
      lobbyOverlayText = 'Waiting for players, minimum 2 players needed to start game';
    } else {
      lobbyOverlayText = 'Waiting for players, press F to start';
    }
  } else if (gameState === 'ended' && lobbyOverlayText) {
    // keep current winner/draw text
  } else {
    lobbyOverlayText = '';
  }
}

document.getElementById('join-btn').onclick = () => {
  if (USE_TWITCH_LOGIN) return;
  const username = document.getElementById('username').value;
  socket.emit('join', username);
  document.getElementById('join-screen').style.display = 'none';
  canvas.style.display = '';
  lobbyOverlayText = 'Joining...';
  spectator = false;
  stopAnimation();
  animationFrameId = requestAnimationFrame(drawLobbyOverlay);
};

document.getElementById('twitch-login-btn').onclick = () => {
  fetch('./twitch_client_id').then(r => r.json()).then(cfg => {
    const clientId = cfg.client_id;
    const redirectUri = window.location.origin + window.location.pathname;
    const scope = 'user:read:email';
    const state = Math.random().toString(36).slice(2);
    localStorage.setItem('twitch_oauth_state', state);
    const url = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${scope}&state=${state}`;
    window.location = url;
  });
};

function getTwitchTokenFromUrl() {
  if (window.location.hash && window.location.hash.includes('access_token')) {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get('access_token');
    const state = params.get('state');
    return accessToken;
  }
  return null;
}

(async () => {
  const token = getTwitchTokenFromUrl();
  if (USE_TWITCH_LOGIN && token) {
    history.replaceState(null, '', window.location.pathname);
    socket.emit('join', { twitchToken: token });
    document.getElementById('join-screen').style.display = 'none';
    canvas.style.display = '';
    lobbyOverlayText = 'Joining...';
    spectator = false;
    stopAnimation();
    animationFrameId = requestAnimationFrame(drawLobbyOverlay);
  }
})();

socket.on('auth_error', (msg) => {
  alert('Authentication error: ' + msg);
  document.getElementById('join-screen').style.display = '';
});

const playerListDiv = document.createElement('div');
playerListDiv.id = 'player-list';
playerListDiv.style.position = 'absolute';
playerListDiv.style.top = '10px';
playerListDiv.style.right = '10px';
playerListDiv.style.background = 'rgba(255,255,255,0.8)';
playerListDiv.style.padding = '10px';
playerListDiv.style.borderRadius = '5px';
playerListDiv.style.fontFamily = 'sans-serif';
playerListDiv.innerText = 'Players:';
document.body.appendChild(playerListDiv);

socket.on('player_list', (data) => {
  allPlayers = {};
  let playerArr = [];
  let spectatorArr = [];
  if (Array.isArray(data)) {
    playerArr = data;
  } else {
    playerArr = data.players || [];
    spectatorArr = data.spectators || [];
  }
  for (const p of playerArr) {
    allPlayers[p.id] = p;
  }
  let html = '<b>Players:</b><br>' + playerArr.map(p => escapeHTML(p.username)).join('<br>');
  if (spectatorArr.length > 0) {
    html += '<br><b>Spectators:</b><br>' + spectatorArr.map(s => escapeHTML(s.username)).join('<br>');
  }
  playerListDiv.innerHTML = html;
  updateLobbyOverlay();
});

socket.on('can_start', (canStart) => {
  if (canStart) {
    playerListDiv.innerHTML += '<br><span style="color: green;">Ready to start!</span>';
  }
});

socket.on('player_hp', (state) => {
  hpState = state;
});

socket.on('sim_state', (state) => {
  simState = state;
});
socket.on('blood_particle', ({ x, y }) => {
  const count = 8 + Math.floor(Math.random() * 6);
  for (let i = 0; i < count; ++i) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 2.5;
    bloodParticles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      life: 0,
      maxLife: 500 + Math.random() * 400
    });
  }
});

function drawRectLimb(ctx, part, width, height, color="#444") {
  ctx.save();
  ctx.translate(part.x, part.y);
  ctx.rotate(part.angle || 0);
  ctx.fillStyle = color;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawStickmanParts(ctx, ragdoll, name, headColor='#ffe0b2', hp=100) {
  ctx.save();
  let h = ragdoll.head, b = ragdoll.body, la = ragdoll.leftArm, ra = ragdoll.rightArm, ll = ragdoll.leftLeg, rl = ragdoll.rightLeg;
  drawRectLimb(ctx, la, 40, 15);
  drawRectLimb(ctx, ra, 40, 15);
  drawRectLimb(ctx, b, 20, 50);
  drawRectLimb(ctx, ll, 20, 40);
  drawRectLimb(ctx, rl, 20, 40);
  ctx.beginPath();
  ctx.arc(h.x, h.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = headColor;
  ctx.fill();
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.font = '14px sans-serif';
  ctx.fillStyle = "#222";
  ctx.textAlign = 'center';
  ctx.fillText(`${name} (${hp})`, h.x, h.y - 30);

  if (ragdoll.leftNut) {
    ctx.beginPath();
    ctx.arc(ragdoll.leftNut.x, ragdoll.leftNut.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#b8a586";
    ctx.strokeStyle = "#7a6046";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }
  if (ragdoll.rightNut) {
    ctx.beginPath();
    ctx.arc(ragdoll.rightNut.x, ragdoll.rightNut.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#b8a586";
    ctx.strokeStyle = "#7a6046";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawGame() {
  updateLobbyOverlay();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let p of bloodParticles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5 + Math.random()*3, 0, Math.PI*2);
    ctx.fillStyle = "#a00";
    ctx.shadowColor = "#f55";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15;
    p.vx *= 0.95;
    p.vy *= 0.98;
    p.life += 33;
    p.alpha = 1 - (p.life / p.maxLife);
  }
  bloodParticles = bloodParticles.filter(p => p.life < p.maxLife && p.alpha > 0.05);

  for (let id in simState) {
    let ragdoll = simState[id];
    let playerName = '';
    for (let pid in allPlayers) {
      if (allPlayers[pid].id === id) {
        playerName = allPlayers[pid].username;
      }
    }
    const playerHp = hpState[id] ?? 0;
    let color = (playerHp > 0) ? "#ffe0b2" : "#888";
    if (ragdoll && ragdoll.head) {
      drawStickmanParts(ctx, ragdoll, playerName, color, playerHp);
    }
  }

  // Draw timer if roundEndsAt is set (top center)
  if (roundEndsAt && (gameState === 'running' || gameState === 'countdown')) {
    let msLeft = roundEndsAt - Date.now();
    if (msLeft < 0) msLeft = 0;
    let sec = Math.floor(msLeft / 1000) % 60;
    let min = Math.floor(msLeft / 60000);
    let timeStr = `${min}:${sec.toString().padStart(2,'0')}`;
    ctx.save();
    ctx.font = "32px sans-serif";
    ctx.fillStyle = msLeft <= 30000 ? "#c33" : "#256";
    ctx.textAlign = "center";
    ctx.globalAlpha = 0.9;
    ctx.fillText(timeStr, canvas.width/2, 50);
    ctx.restore();
  }

  if (lobbyOverlayText) {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#f5f5dc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
    ctx.font = (gameState === 'ended') ? "40px sans-serif" : "44px sans-serif";
    ctx.fillStyle = "#2c2c2c";
    ctx.textAlign = "center";
    ctx.fillText(lobbyOverlayText, canvas.width/2, canvas.height/2);
    ctx.restore();
  }
  if (
    (gameState === 'running') ||
    (spectator && (gameState === 'running' || gameState === 'countdown')) ||
    gameState === 'ended'
  ) {
    animationFrameId = requestAnimationFrame(drawGame);
  }
}

function drawLobbyOverlay() {
  if (gameState === 'ended') return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Draw timer in lobby if roundEndsAt exists (during countdown)
  if (roundEndsAt && (gameState === 'countdown')) {
    let msLeft = roundEndsAt - Date.now();
    if (msLeft < 0) msLeft = 0;
    let sec = Math.floor(msLeft / 1000) % 60;
    let min = Math.floor(msLeft / 60000);
    let timeStr = `${min}:${sec.toString().padStart(2,'0')}`;
    ctx.save();
    ctx.font = "32px sans-serif";
    ctx.fillStyle = msLeft <= 10000 ? "#c33" : "#256";
    ctx.textAlign = "center";
    ctx.globalAlpha = 0.9;
    ctx.fillText(timeStr, canvas.width/2, 50);
    ctx.restore();
  }

  if (gameState === 'waiting' && canvas.style.display !== 'none' || lobbyOverlayText === 'Joining...') {
    ctx.save();
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#f5f5dc";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
    ctx.font = "44px sans-serif";
    ctx.fillStyle = "#2c2c2c";
    ctx.textAlign = "center";
    ctx.fillText(lobbyOverlayText, canvas.width/2, canvas.height/2);
    ctx.restore();
    if (gameState === 'waiting' || lobbyOverlayText === 'Joining...') {
      animationFrameId = requestAnimationFrame(drawLobbyOverlay);
    }
  }
}

socket.on('game_over', ({ winner }) => {
  gameState = 'ended';
  spectator = false;
  // stopAnimation(); // Don't stop animation!
  canvas.style.display = '';
  // ctx.clearRect(0, 0, canvas.width, canvas.height); // Don't clear explicitly!
  lobbyOverlayText = winner ? `Winner: ${escapeHTML(winner)}!` : "Draw!";
  animationFrameId = requestAnimationFrame(drawGame);
});

let controls = { up: false, down: false, left: false, right: false };

function sendControls() {
  socket.emit('input', controls);
}

let cheatBuffer = '';
function resetCheatBuffer() {
  cheatBuffer = '';
}
function checkForDeeznutsCheat(key) {
  cheatBuffer += key.toLowerCase();
  if (cheatBuffer.length > 8) cheatBuffer = cheatBuffer.slice(-8);
  if (cheatBuffer === 'deeznuts') {
    socket.emit('spawn_nuts');
    resetCheatBuffer();
  }
}

window.addEventListener('keydown', (e) => {
  checkForDeeznutsCheat(e.key);
  let changed = false;
  if (gameState === 'waiting' && (e.key === 'f' || e.key === 'F')) {
    if (Object.keys(allPlayers).length >= 2) {
      socket.emit('start_game');
    }
  }
  if (e.key === 'w') { if (!controls.up) {controls.up = true; changed = true;} }
  if (e.key === 'a') { if (!controls.left) {controls.left = true; changed = true;} }
  if (e.key === 's') { if (!controls.down) {controls.down = true; changed = true;} }
  if (e.key === 'd') { if (!controls.right) {controls.right = true; changed = true;} }
  if (changed) sendControls();
});
window.addEventListener('keyup', (e) => {
  let changed = false;
  if (e.key === 'w') { if (controls.up) {controls.up = false; changed = true;} }
  if (e.key === 'a') { if (controls.left) {controls.left = false; changed = true;} }
  if (e.key === 's') { if (controls.down) {controls.down = false; changed = true;} }
  if (e.key === 'd') { if (controls.right) {controls.right = false; changed = true;} }
  if (changed) sendControls();
});

socket.on('connect', () => {
  gotSocketId = true;
  if (pendingGameState) {
    handleGameState(pendingGameState);
    pendingGameState = null;
  }
});

socket.on('game_state', (stateObj) => {
  if (!gotSocketId || !socket.id) {
    pendingGameState = stateObj;
    return;
  }
  roundEndsAt = stateObj.roundEndsAt || null;
  handleGameState(stateObj);
});

function handleGameState(stateObj) {
  gameState = stateObj.state;
  allPlayers = stateObj.players || {};
  spectator = !(socket.id in allPlayers) && (gameState === 'running' || gameState === 'countdown');

  if (gameState === 'countdown') {
    playerListDiv.innerHTML = playerListDiv.innerHTML.replace(/<br><b>Game starts in.*?\.*?<\/b>/g, '');
    playerListDiv.innerHTML += `<br><b>Game starts in ${stateObj.countdown}...</b>`;
  }

  stopAnimation();

  if (
    gameState === 'running' ||
    gameState === 'countdown' ||
    (spectator && (gameState === 'running' || gameState === 'countdown'))
  ) {
    canvas.style.display = '';
    updateLobbyOverlay();
    animationFrameId = requestAnimationFrame(drawGame);
  } else if (gameState === 'waiting') {
    spectator = false;
    canvas.style.display = '';
    updateLobbyOverlay();
    animationFrameId = requestAnimationFrame(drawLobbyOverlay);
  } else {
    updateLobbyOverlay();
  }
}
