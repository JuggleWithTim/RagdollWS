const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const Matter = require('matter-js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};
let spectators = {};
let minPlayers = 2;
let gameState = 'waiting'; // waiting | countdown | running | ended
let countdown = 0;
let roundInterval = null;
let roundTimer = null;
let roundStartTime = null;
let engine = Matter.Engine.create();
engine.world.gravity.y = 0.1;
const arenaWidth = 1280;
const arenaHeight = 720;

let stickmen = {};
let playerInputs = {};

let playerHP = {};
const MAX_HP = 1000;

const hitMatrix = {
  head:   { foot: 40, hand: 25, other: 15 },
  body:   { foot: 20, hand: 15, other: 10 },
  arm:    { foot: 10, hand: 5,  other: 3 },
  leg:    { foot: 10, hand: 5,  other: 3 },
};

const partAttackType = {
  leftLeg: 'foot', rightLeg: 'foot',
  leftArm: 'hand', rightArm: 'hand',
  head: 'other', body: 'other',
};

const partVulnerableArea = {
  head: 'head', body: 'body',
  leftArm: 'arm', rightArm: 'arm',
  leftLeg: 'leg', rightLeg: 'leg',
};

function addArenaBorders() {
    const wallOptions = { isStatic: true, restitution: 0.7, label: 'arena' };
    const borders = [
        Matter.Bodies.rectangle(arenaWidth / 2, -10, arenaWidth, 20, wallOptions),
        Matter.Bodies.rectangle(arenaWidth / 2, arenaHeight + 10, arenaWidth, 20, wallOptions),
        Matter.Bodies.rectangle(-10, arenaHeight / 2, 20, arenaHeight, wallOptions),
        Matter.Bodies.rectangle(arenaWidth + 10, arenaHeight / 2, 20, arenaHeight, wallOptions),
    ];
    borders.forEach(wall => Matter.World.add(engine.world, wall));
}

function makeStickman(x, y, playerId) {
    let head = Matter.Bodies.circle(x, y, 20, { restitution: 0.8, label: 'head' });
    let body = Matter.Bodies.rectangle(x, y + 45, 20, 50, { restitution: 0.2, label: 'body' });
    let leftArm = Matter.Bodies.rectangle(x - 30, y + 30, 40, 15, { restitution: 1.0, label: 'leftArm' });
    let rightArm = Matter.Bodies.rectangle(x + 30, y + 30, 40, 15, { restitution: 1.0, label: 'rightArm' });
    let leftLeg = Matter.Bodies.rectangle(x - 10, y + 90, 20, 40, { restitution: 1.0, label: 'leftLeg' });
    let rightLeg = Matter.Bodies.rectangle(x + 10, y + 90, 20, 40, { restitution: 1.0, label: 'rightLeg' });

    [
        {b: head, n: 'head'}, {b: body, n: 'body'},
        {b: leftArm, n: 'leftArm'}, {b: rightArm, n: 'rightArm'},
        {b: leftLeg, n: 'leftLeg'}, {b: rightLeg, n: 'rightLeg'}
    ].forEach(({b, n}) => { b.playerId = playerId; b.partName = n; });

    let constraints = [
        Matter.Constraint.create({
            bodyA: head,
            pointA: { x: 0, y: 20 },
            bodyB: body,
            pointB: { x: 0, y: -25 },
            stiffness: 0.7,
            damping: 0.5
        }),
        Matter.Constraint.create({
            bodyA: body,
            pointA: { x: -10, y: -15 },
            bodyB: leftArm,
            pointB: { x: 15, y: 0 },
            stiffness: 0.6,
            damping: 0.3
        }),
        Matter.Constraint.create({
            bodyA: body,
            pointA: { x: 10, y: -15 },
            bodyB: rightArm,
            pointB: { x: -15, y: 0 },
            stiffness: 0.6,
            damping: 0.3
        }),
        Matter.Constraint.create({
            bodyA: body,
            pointA: { x: -6, y: 25 },
            bodyB: leftLeg,
            pointB: { x: 0, y: -15 },
            stiffness: 0.6,
            damping: 0.3
        }),
        Matter.Constraint.create({
            bodyA: body,
            pointA: { x: 6, y: 25 },
            bodyB: rightLeg,
            pointB: { x: 0, y: -15 },
            stiffness: 0.6,
            damping: 0.3
        }),
    ];

    return {
        parts: { head, body, leftArm, rightArm, leftLeg, rightLeg },
        bodies: [head, body, leftArm, rightArm, leftLeg, rightLeg],
        constraints: constraints,
    };
}

function broadcastPlayerList() {
    const playerList = Object.values(players).map(p => ({
        id: p.id,
        username: p.username,
    }));
    const spectatorList = Object.values(spectators).map(p => ({
        id: p.id,
        username: p.username,
    }));
    io.emit('player_list', { players: playerList, spectators: spectatorList });
}

function startCountdown() {
    gameState = 'countdown';
    countdown = 5;
    io.emit('game_state', { state: 'countdown', countdown });
    roundInterval = setInterval(() => {
        countdown--;
        io.emit('game_state', { state: 'countdown', countdown });
        if (countdown <= 0) {
            clearInterval(roundInterval);
            startGame();
        }
    }, 1000);
}

function startGame() {
    gameState = 'running';
    addArenaBorders();
    playerHP = {};
    for (let id in players) {
        playerHP[id] = MAX_HP;
        players[id].eliminated = false;
    }
    Object.values(players).forEach(player => {
        let sx = 100 + Math.random() * 600;
        let sy = 100 + Math.random() * 400;
        let ragdoll = makeStickman(sx, sy, player.id);
        ragdoll.bodies.forEach(b => Matter.World.add(engine.world, b));
        ragdoll.constraints.forEach(c => Matter.World.add(engine.world, c));
        stickmen[player.id] = ragdoll;
        player.spawn = { x: sx, y: sy };
    });
    if (roundTimer) clearTimeout(roundTimer);
    roundStartTime = Date.now();
    roundTimer = setTimeout(() => {
        if (gameState === 'running') {
            io.emit('game_over', { winner: null });
        gameState = 'ended';
            setTimeout(resetToLobby, 4000);
    }
    }, 5 * 60 * 1000);
    io.emit('game_state', {
        state: 'running',
            players: players,
        roundEndsAt: roundStartTime + 5 * 60 * 1000
        });
    io.emit('player_hp', playerHP);
}

function resetToLobby() {
    Matter.World.clear(engine.world, false);
    stickmen = {};
    playerInputs = {};
    if (roundTimer) {
        clearTimeout(roundTimer);
        roundTimer = null;
    }
    roundStartTime = null;
    for (let id in spectators) {
        players[id] = spectators[id];
    }
    spectators = {};
    gameState = 'waiting';
    io.emit('game_state', { state: 'waiting' });
        broadcastPlayerList();
        }

function applyDamage(playerId, dmg) {
    if (gameState !== 'running' || !playerHP[playerId]) return;
    if (players[playerId] && players[playerId].eliminated) return;
    playerHP[playerId] -= dmg;
    if (playerHP[playerId] < 0) playerHP[playerId] = 0;
    io.emit('player_hp', playerHP);
    if (playerHP[playerId] === 0) {
        if (players[playerId]) players[playerId].eliminated = true;
        if (stickmen[playerId] && stickmen[playerId].constraints) {
            for (const c of stickmen[playerId].constraints) {
                Matter.World.remove(engine.world, c);
            }
            stickmen[playerId].constraints = [];
        }
        checkForWinner();
    }
}

function checkForWinner() {
    const alivePlayers = Object.keys(playerHP).filter(pid => playerHP[pid] > 0);
    if (gameState !== 'running' && gameState !== 'ended') return;
    if (alivePlayers.length === 1) {
        const winnerId = alivePlayers[0];
        io.emit('game_over', { winner: players[winnerId]?.username || '???' });
        gameState = 'ended';
        if (roundTimer) {
            clearTimeout(roundTimer);
            roundTimer = null;
        }
        roundStartTime = null;
        setTimeout(resetToLobby, 5000);
    }
    if (alivePlayers.length === 0) {
        io.emit('game_over', { winner: null });
        gameState = 'ended';
        if (roundTimer) {
            clearTimeout(roundTimer);
            roundTimer = null;
        }
        roundStartTime = null;
        setTimeout(resetToLobby, 4000);
    }
}

function ragdollFromPlayer(ownerId, partName) {
    return stickmen[ownerId]?.parts[partName];
}

function doBounce(bodyA, bodyB) {
    if (!bodyA || !bodyB) return;
    const dx = bodyB.position.x - bodyA.position.x;
    const dy = bodyB.position.y - bodyA.position.y;

    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 12;

    Matter.Body.setVelocity(bodyA, {
        x: bodyA.velocity.x - (dx / dist) * speed,
        y: bodyA.velocity.y - (dy / dist) * speed
    });
    Matter.Body.setVelocity(bodyB, {
        x: bodyB.velocity.x + (dx / dist) * speed,
        y: bodyB.velocity.y + (dy / dist) * speed
});

    const rotationFactor = 0.1;
    Matter.Body.setAngularVelocity(bodyA, bodyA.angularVelocity + (Math.random() - 0.5) * rotationFactor);
    Matter.Body.setAngularVelocity(bodyB, bodyB.angularVelocity + (Math.random() - 0.5) * rotationFactor);
}

Matter.Events.on(engine, 'collisionStart', event => {
    if (gameState !== 'running') return;
    for (let pair of event.pairs) {
        let [bodyA, bodyB] = [pair.bodyA, pair.bodyB];
        let ownerA = bodyA.playerId, ownerB = bodyB.playerId;
        if (!ownerA || !ownerB || ownerA === ownerB) continue;
        let partA = bodyA.partName, partB = bodyB.partName;
        if ((players[ownerA] && players[ownerA].eliminated) ||
            (players[ownerB] && players[ownerB].eliminated)) {
            continue;
        }
        const px = (bodyA.position.x + bodyB.position.x) / 2;
        const py = (bodyA.position.y + bodyB.position.y) / 2;
        io.emit('blood_particle', { x: px, y: py });
        if (partVulnerableArea[partB] && partAttackType[partA]) {
            let area = partVulnerableArea[partB];
            let atk = partAttackType[partA];
            let dmg = hitMatrix[area]?.[atk] ?? 0;
            if (dmg > 0) {
                applyDamage(ownerB, dmg);
                doBounce(ragdollFromPlayer(ownerA, partA), ragdollFromPlayer(ownerB, partB));
            }
        }
        if (partVulnerableArea[partA] && partAttackType[partB]) {
            let area = partVulnerableArea[partA];
            let atk = partAttackType[partB];
            let dmg = hitMatrix[area]?.[atk] ?? 0;
            if (dmg > 0) {
                applyDamage(ownerA, dmg);
                doBounce(ragdollFromPlayer(ownerB, partB), ragdollFromPlayer(ownerA, partA));
            }
        }
    }
});

io.on('connection', (socket) => {
    socket.on('join', (username) => {
        if (!username || typeof username !== 'string') return;
        username = username.substring(0, 16);

        if (gameState === 'waiting') {
            players[socket.id] = {
                id: socket.id,
                username,
                };
        } else {
            spectators[socket.id] = {
                id: socket.id,
                username,
            };
    }
        broadcastPlayerList();
        io.emit('can_start', Object.keys(players).length >= minPlayers);

        socket.emit('game_state', {
            state: gameState,
            players: players,
            countdown: countdown,
            roundEndsAt: roundStartTime ? (roundStartTime + 5 * 60 * 1000) : null
        });
        socket.emit('player_hp', playerHP);
    });

    socket.on('input', (controls) => {
        playerInputs[socket.id] = controls;
    });

    socket.on('start_game', () => {
        if (gameState === 'waiting' && Object.keys(players).length >= minPlayers) {
            startCountdown();
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        delete spectators[socket.id];
        delete stickmen[socket.id];
        delete playerInputs[socket.id];
        delete playerHP[socket.id];
        broadcastPlayerList();
        io.emit('can_start', Object.keys(players).length >= minPlayers);
        checkForWinner();
        if (gameState !== 'waiting' && Object.keys(players).length < minPlayers) {
            resetToLobby();
        }
    });
});

setInterval(() => {
    if (["running", "ended"].includes(gameState)) {
        for (let id in stickmen) {
            if (players[id] && players[id].eliminated) continue;
            const input = playerInputs[id] || {};
            const ragdoll = stickmen[id];
            if (ragdoll && ragdoll.parts && ragdoll.parts.head) {
                const forceAmount = 0.0035;
                let fx = 0, fy = 0;
                if (input.up) fy -= forceAmount;
                if (input.down) fy += forceAmount;
                if (input.left) fx -= forceAmount;
                if (input.right) fx += forceAmount;
                if (fx !== 0 || fy !== 0) {
                    Matter.Body.applyForce(
                        ragdoll.parts.head,
                        ragdoll.parts.head.position,
                        { x: fx, y: fy }
                    );

                    const spinImpulse = 0.05;
                    if (input.left && !input.right) {
                        Matter.Body.setAngularVelocity(
                            ragdoll.parts.head,
                            ragdoll.parts.head.angularVelocity - spinImpulse
                        );
                    } else if (input.right && !input.left) {
                        Matter.Body.setAngularVelocity(
                            ragdoll.parts.head,
                            ragdoll.parts.head.angularVelocity + spinImpulse
                        );
                    }
                }
            }
        }

        Matter.Engine.update(engine, 1000 / 60);

        let simState = {};
        for (let id in stickmen) {
            let ragdoll = stickmen[id];
            simState[id] = {};
            for (let partName in ragdoll.parts) {
                let b = ragdoll.parts[partName];
                simState[id][partName] = {
                    x: b.position.x,
                    y: b.position.y,
                    angle: b.angle,
                };
            }
        }
        io.emit('sim_state', simState);
    }
}, 1000 / 30);

server.listen(3000, () => console.log('Game server running on http://localhost:3000/'));