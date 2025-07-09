const socket = io();
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
canvas.style.display = 'none';

let gameState = 'waiting';
let allPlayers = {};
let simState = {};
let hpState = {};

document.getElementById('join-btn').onclick = () => {
  const username = document.getElementById('username').value;
  socket.emit('join', username);
    document.getElementById('join-screen').style.display = 'none';
    canvas.style.display = '';
};

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

socket.on('player_list', (playerArr) => {
  allPlayers = {};
  for (const p of playerArr) {
    allPlayers[p.id] = p;
  }
  playerListDiv.innerHTML = '<b>Players:</b><br>' + playerArr.map(p => p.username).join('<br>');
});

socket.on('can_start', (canStart) => {
  if (canStart) {
    playerListDiv.innerHTML += '<br><span style="color: green;">Ready to start!</span>';
  }
});

socket.on('player_hp', (state) => {
  hpState = state;
});
socket.on('game_state', (stateObj) => {
  gameState = stateObj.state;
  if (gameState === 'countdown') {
    playerListDiv.innerHTML = playerListDiv.innerHTML.replace(/<br><b>Game starts in.*?\.*?<\/b>/g, '');
    playerListDiv.innerHTML += `<br><b>Game starts in ${stateObj.countdown}...</b>`;
  }
  if (gameState === 'running') {
    allPlayers = stateObj.players || {};
    playerListDiv.innerHTML = '<b>Players:</b><br>' + Object.values(allPlayers).map(p => p.username).join('<br>');
    document.getElementById('join-screen').style.display = 'none';
    canvas.style.display = '';
    requestAnimationFrame(drawGame);
  }
  if (gameState === 'waiting') {
    playerListDiv.innerHTML = '<b>Players:</b><br>' + Object.values(allPlayers).map(p => p.username).join('<br>');
    canvas.style.display = 'none';
}
});

socket.on('sim_state', (state) => {
  simState = state;
});

function drawStickmanParts(ctx, ragdoll, name, headColor='#ffe0b2', hp=100) {
  ctx.save();

  let h = ragdoll.head, b = ragdoll.body, la = ragdoll.leftArm, ra = ragdoll.rightArm, ll = ragdoll.leftLeg, rl = ragdoll.rightLeg;

  ctx.lineWidth = 6;
  ctx.strokeStyle = "#444";

  // Draw arms
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(la.x, la.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(ra.x, ra.y);
  ctx.stroke();

  // Draw body (from head to torso)
  ctx.beginPath();
  ctx.moveTo(h.x, h.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Draw legs
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(ll.x, ll.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(rl.x, rl.y);
  ctx.stroke();

  // Draw the head
  ctx.beginPath();
  ctx.arc(h.x, h.y, 20, 0, Math.PI * 2);
  ctx.fillStyle = headColor;
  ctx.fill();
  ctx.stroke();

  // Draw player name and HP
  ctx.font = '14px sans-serif';
  ctx.fillStyle = "#222";
  ctx.textAlign = 'center';
  ctx.fillText(`${name} (${hp})`, h.x, h.y - 30);
  ctx.restore();
}

function drawGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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

  if (gameState === 'running') {
    requestAnimationFrame(drawGame);
  }
}

socket.on('game_over', ({ winner }) => {
  ctx.save();
  ctx.font = "40px sans-serif";
  ctx.fillStyle = "#2196f3";
  ctx.textAlign = "center";
  ctx.fillText(winner ? `Winner: ${winner}!` : "Draw!", canvas.width/2, canvas.height/2);
  ctx.restore();
});
let controls = { up: false, down: false, left: false, right: false };

function sendControls() {
    socket.emit('input', controls);
}

window.addEventListener('keydown', (e) => {
    let changed = false;
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

