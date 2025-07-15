const socket = io({
  path: window.location.pathname.replace(/[^/]+$/, '') + 'socket.io'
});
const canvas = document.getElementById('twitch-canvas');
const ctx = canvas.getContext('2d');

let gameState = 'waiting';
let allPlayers = {};
let simState = {};
let hpState = {};
let bloodParticles = [];
let animationFrameId = null;
let roundEndsAt = null;
let winnerText = '';

socket.emit('join', { username: 'Twitch Overlay', spectator: true });

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

  if (name) {
    ctx.font = '14px sans-serif';
    ctx.fillStyle = "#222";
    ctx.textAlign = 'center';
    ctx.fillText(`${name} (${hp})`, h.x, h.y - 30);
  }
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (gameState === "running" || gameState === "countdown") {
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
  } else {
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
      const playerHp = hpState[id] ?? 0;
      let color = (playerHp > 0) ? "#ffe0b2" : "#888";
      if (ragdoll && ragdoll.head) {
        drawStickmanParts(ctx, ragdoll, "", color, playerHp);
  }
    }
  }

  if (gameState === 'ended' && winnerText) {
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.font = "44px sans-serif";
    ctx.fillStyle = "#ffe87c";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#231";
    ctx.lineWidth = 6;
    ctx.strokeText(winnerText, canvas.width/2, canvas.height/2);
    ctx.fillText(winnerText, canvas.width/2, canvas.height/2);
    ctx.restore();
  }
animationFrameId = requestAnimationFrame(drawGame);
}

socket.on('player_list', (data) => {
  allPlayers = {};
  let playerArr = [];
  if (Array.isArray(data)) {
    playerArr = data;
  } else {
    playerArr = data.players || [];
  }
  for (const p of playerArr) {
    allPlayers[p.id] = p;
  }
});

socket.on('player_hp', (state) => { hpState = state; });
socket.on('sim_state', (state) => { simState = state; });
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

socket.on('game_state', (stateObj) => {
  gameState = stateObj.state;
  allPlayers = stateObj.players || {};
  roundEndsAt = stateObj.roundEndsAt || null;
  if (gameState === 'waiting') {
    simState = {};
    hpState = {};
    bloodParticles = [];
    winnerText = '';
  }
});

socket.on('game_over', ({ winner }) => {
  gameState = 'ended';
  winnerText = winner ? `Winner: ${escapeHTML(winner)}!` : "Draw!";
  hpState = {};
});

animationFrameId = requestAnimationFrame(drawGame);
