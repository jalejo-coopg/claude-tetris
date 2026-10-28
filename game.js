'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#9e9e9e', // N - tuerca (gris metálico)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N (tuerca)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const comboEl = document.getElementById('combo');
const b2bBadge = document.getElementById('b2b-badge');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const pauseMenu = document.getElementById('pause-menu');
const pauseMain = document.getElementById('pause-main');
const pauseKeys = document.getElementById('pause-keys');
const pauseStartLevel = document.getElementById('pause-start-level');
let startLevel = 1;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let comboCount = 0;
let gameBestCombo = 0;
let b2bActive = false;
let lastMoveWasRotate = false;

// Visual effects
let particles = [];
let floatingTexts = [];
let shakeTime = 0;
let shakeIntensity = 0;

// Web Audio API Procedural Synthesizer
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(freq, type, duration, gainValue = 0.08, delay = 0) {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime + delay;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // Graceful fallback if audio is blocked
  }
}

function playMoveSound() {
  playTone(200, 'square', 0.03, 0.02);
}

function playRotateSound() {
  playTone(320, 'triangle', 0.05, 0.04);
}

function playDropSound() {
  playTone(160, 'square', 0.06, 0.04);
}

function playComboSound(combo) {
  const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];
  const idx = Math.min(Math.max(0, combo - 1), scale.length - 1);
  const baseFreq = scale[idx];
  playTone(baseFreq, 'square', 0.12, 0.07);
  playTone(baseFreq * 1.5, 'triangle', 0.16, 0.05, 0.03);
}

function playTetrisSound() {
  playTone(523.25, 'square', 0.25, 0.09, 0);      // C5
  playTone(659.25, 'square', 0.25, 0.09, 0.06);   // E5
  playTone(783.99, 'square', 0.3, 0.1, 0.12);     // G5
  playTone(1046.50, 'triangle', 0.35, 0.1, 0.18); // C6
}

function playTSpinSound() {
  playTone(440, 'sawtooth', 0.1, 0.06, 0);
  playTone(554.37, 'sawtooth', 0.1, 0.06, 0.05);
  playTone(659.25, 'square', 0.18, 0.08, 0.1);
  playTone(880, 'triangle', 0.22, 0.08, 0.15);
}

function playPerfectClearSound() {
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
  notes.forEach((f, i) => {
    playTone(f, i % 2 === 0 ? 'square' : 'triangle', 0.2, 0.09, i * 0.08);
  });
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 8) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastMoveWasRotate = true;
      playRotateSound();
      return;
    }
  }
}

function checkTSpin() {
  // Official Tetris 3-corner rule: Piece is 'T', last action was rotation,
  // and at least 3 of 4 corners around the center are occupied.
  if (current.type !== 3 || !lastMoveWasRotate) return false;
  let occupiedCorners = 0;
  const corners = [
    [current.x, current.y],
    [current.x + 2, current.y],
    [current.x, current.y + 2],
    [current.x + 2, current.y + 2],
  ];
  for (const [cx, cy] of corners) {
    if (cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && board[cy][cx] !== 0)) {
      occupiedCorners++;
    }
  }
  return occupiedCorners >= 3;
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function spawnLineParticles(row) {
  for (let c = 0; c < COLS; c++) {
    for (let i = 0; i < 4; i++) {
      particles.push({
        x: (c + Math.random()) * BLOCK,
        y: (row + Math.random()) * BLOCK,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 1.5) * 4,
        alpha: 1,
        color: SKINS[currentSkin].colors[Math.floor(Math.random() * 7) + 1],
        size: Math.random() * 4 + 2,
      });
    }
  }
}

function spawnFloatingText(text, x, y, color = '#fff', size = 18) {
  floatingTexts.push({
    text,
    x,
    y,
    vy: -0.9,
    alpha: 1,
    color,
    size,
    lifetime: 0,
  });
}

function triggerScreenShake(intensity, durationMs) {
  shakeIntensity = intensity;
  shakeTime = durationMs;
}

function clearLines(wasTSpin) {
  const clearedRows = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      clearedRows.push(r);
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      r++;
    }
  }
  const cleared = clearedRows.length;

  if (cleared > 0 || wasTSpin) {
    // Spawn particles for cleared lines
    if (cleared > 0) {
      for (const row of clearedRows) {
        spawnLineParticles(row);
      }
    }

    const isDifficult = (cleared === 4) || (wasTSpin && cleared > 0);
    let baseScore = 0;
    let label = '';

    if (wasTSpin) {
      if (cleared === 0) {
        baseScore = 100 * level;
        label = 'T-SPIN';
      } else if (cleared === 1) {
        baseScore = 800 * level;
        label = 'T-SPIN SINGLE';
      } else if (cleared === 2) {
        baseScore = 1200 * level;
        label = 'T-SPIN DOUBLE';
      } else if (cleared >= 3) {
        baseScore = 1600 * level;
        label = 'T-SPIN TRIPLE';
      }
      playTSpinSound();
    } else if (cleared === 4) {
      baseScore = 800 * level;
      label = 'TETRIS';
      playTetrisSound();
    } else if (cleared > 0) {
      baseScore = LINE_SCORES[cleared] * level;
      if (cleared === 1) label = 'SINGLE';
      else if (cleared === 2) label = 'DOUBLE';
      else if (cleared === 3) label = 'TRIPLE';
    }

    // Back-to-Back logic
    if (isDifficult) {
      if (b2bActive) {
        baseScore = Math.floor(baseScore * 1.5);
        label = `B2B ${label}`;
        spawnFloatingText('B2B 1.5x!', 150, 240, '#ffb74d', 20);
      } else {
        b2bActive = true;
      }
    } else if (cleared > 0) {
      b2bActive = false;
    }

    // Combo logic
    if (cleared > 0) {
      comboCount++;
      gameBestCombo = Math.max(gameBestCombo, comboCount);
      if (comboCount > 1) {
        baseScore = baseScore * comboCount;
        spawnFloatingText(`COMBO x${comboCount}!`, 150, 200, '#ffd54f', 24);
        playComboSound(comboCount);
      } else {
        if (!wasTSpin && cleared < 4) {
          playComboSound(1);
        }
      }
      lines += cleared;
    }

    // Perfect Clear check
    const isPerfectClear = cleared > 0 && board.every(row => row.every(cell => cell === 0));
    if (isPerfectClear) {
      const pcBonus = 3500 * level;
      baseScore += pcBonus;
      spawnFloatingText('PERFECT CLEAR!', 150, 160, '#4dd0e1', 26);
      playPerfectClearSound();
      triggerScreenShake(10, 300);
    }

    if (label) {
      spawnFloatingText(label, 150, 270, '#ffffff', 18);
    }

    if (cleared === 4 || wasTSpin || comboCount >= 3) {
      triggerScreenShake(Math.min(8, 3 + comboCount), 180);
    }

    score += baseScore;
    level = startLevel + Math.floor(lines / 10);
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  } else {
    // Dropped a piece without clearing lines: breaks combo!
    comboCount = 0;
  }

  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  playDropSound();
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    playMoveSound();
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const wasTSpin = checkTSpin();
  merge();
  clearLines(wasTSpin);
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  lastMoveWasRotate = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  if (comboEl) {
    comboEl.textContent = comboCount > 0 ? `x${comboCount}` : '0';
    if (comboCount > 1) {
      comboEl.classList.add('combo-highlight');
    } else {
      comboEl.classList.remove('combo-highlight');
    }
  }
  if (b2bBadge) {
    if (b2bActive) {
      b2bBadge.classList.remove('hidden');
    } else {
      b2bBadge.classList.add('hidden');
    }
  }
}

function fillRounded(context, x, y, w, h, r) {
  context.beginPath();
  if (context.roundRect) context.roundRect(x, y, w, h, r);
  else context.rect(x, y, w, h);
  context.fill();
}

let pixelPattern = null;
function getPixelPattern(context) {
  if (!pixelPattern) {
    const tex = document.createElement('canvas');
    tex.width = 4;
    tex.height = 4;
    const tc = tex.getContext('2d');
    tc.fillStyle = 'rgba(0,0,0,0.25)';
    tc.fillRect(0, 0, 2, 2);
    tc.fillRect(2, 2, 2, 2);
    tc.fillStyle = 'rgba(255,255,255,0.2)';
    tc.fillRect(2, 0, 1, 1);
    tc.fillRect(0, 2, 1, 1);
    pixelPattern = context.createPattern(tex, 'repeat');
  }
  return pixelPattern;
}

const SKINS = {
  retro: {
    label: 'Retro',
    colors: COLORS,
    grid: null,
    drawBlock(context, x, y, colorIndex, size, alpha) {
      context.globalAlpha = alpha ?? 1;
      context.fillStyle = this.colors[colorIndex];
      context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
      // highlight
      context.fillStyle = 'rgba(255,255,255,0.14)';
      context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
      context.globalAlpha = 1;
    },
  },
  neon: {
    label: 'Neón',
    colors: [null, '#00e5ff', '#ffea00', '#e040fb', '#00e676', '#ff1744', '#2979ff', '#ff9100', '#b0bec5'],
    grid: 'rgba(0, 229, 255, 0.12)',
    drawBlock(context, x, y, colorIndex, size, alpha) {
      const color = this.colors[colorIndex];
      context.save();
      context.globalAlpha = alpha ?? 1;
      context.shadowColor = color;
      context.shadowBlur = size * 0.5;
      context.fillStyle = color;
      context.fillRect(x * size + 4, y * size + 4, size - 8, size - 8);
      context.restore();
    },
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a8e6cf', '#fff3b0', '#d4b8e0', '#b5ead7', '#ffb7b2', '#b5d8f7', '#ffd8a8', '#c9c9d6'],
    grid: null,
    drawBlock(context, x, y, colorIndex, size, alpha) {
      context.save();
      context.globalAlpha = alpha ?? 1;
      context.fillStyle = this.colors[colorIndex];
      fillRounded(context, x * size + 2, y * size + 2, size - 4, size - 4, 7);
      context.fillStyle = 'rgba(255,255,255,0.4)';
      fillRounded(context, x * size + 6, y * size + 5, size - 12, 4, 2);
      context.restore();
    },
  },
  pixel: {
    label: 'Pixel',
    colors: COLORS,
    grid: null,
    drawBlock(context, x, y, colorIndex, size, alpha) {
      context.save();
      context.globalAlpha = alpha ?? 1;
      context.fillStyle = this.colors[colorIndex];
      context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
      context.fillStyle = getPixelPattern(context);
      context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
      context.restore();
    },
  },
};

let currentSkin = 'retro';

function loadSavedSkin() {
  let saved = null;
  try {
    saved = localStorage.getItem('tetris-skin');
  } catch {
    // Storage unavailable
  }
  return SKINS[saved] ? saved : 'retro';
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  SKINS[currentSkin].drawBlock(context, x, y, colorIndex, size, alpha);
}

function drawGrid() {
  const skinGrid = SKINS[currentSkin].grid;
  ctx.strokeStyle = skinGrid || getComputedStyle(document.body).getPropertyValue('--grid-line').trim();
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function updateVisualEffects(dt) {
  // Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.12;
    p.alpha -= 0.025;
    if (p.alpha <= 0) particles.splice(i, 1);
  }

  // Floating text
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y += ft.vy;
    ft.lifetime += dt;
    if (ft.lifetime > 450) {
      ft.alpha -= 0.035;
    }
    if (ft.alpha <= 0) floatingTexts.splice(i, 1);
  }

  // Screen shake
  if (shakeTime > 0) {
    shakeTime -= dt;
    if (shakeTime <= 0) {
      shakeTime = 0;
      shakeIntensity = 0;
    }
  }
}

function drawVisualEffects() {
  // Particles
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
    ctx.restore();
  }

  // Floating text
  for (const ft of floatingTexts) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, ft.alpha);
    ctx.fillStyle = ft.color;
    ctx.font = `bold ${ft.size}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}

function draw() {
  ctx.save();
  if (shakeTime > 0) {
    const ox = (Math.random() - 0.5) * shakeIntensity * 2;
    const oy = (Math.random() - 0.5) * shakeIntensity * 2;
    ctx.translate(ox, oy);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  if (!gameOver && current) {
    // ghost
    const gy = ghostY();
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        if (current.shape[r][c])
          drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

    // current piece
    for (let r = 0; r < current.shape.length; r++)
      for (let c = 0; c < current.shape[r].length; c++)
        drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
  }

  drawVisualEffects();
  ctx.restore();
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  animId = null;
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  pauseMenu.classList.add('hidden');
  restartBtn.classList.remove('hidden');
  handleGameOverRecords();
  overlay.classList.remove('hidden');
  draw();
}

function showPauseMain() {
  pauseMain.classList.remove('hidden');
  pauseKeys.classList.add('hidden');
}

function blurFocused() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    blurFocused();
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    restartBtn.classList.add('hidden');
    showPauseMain();
    pauseMenu.classList.remove('hidden');
    overlayRecords.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;

  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }

  if (gameOver) return;

  updateVisualEffects(dt);
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = startLevel;
  comboCount = 0;
  gameBestCombo = 0;
  lastRecordEntry = null;
  pendingRecord = null;
  renderRecords();
  b2bActive = false;
  lastMoveWasRotate = false;
  particles = [];
  floatingTexts = [];
  shakeTime = 0;
  shakeIntensity = 0;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  initAudio();
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
  if (paused && (e.code === 'Space' || e.code === 'Enter')) { e.preventDefault(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) {
        current.x--;
        lastMoveWasRotate = false;
        playMoveSound();
      }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) {
        current.x++;
        lastMoveWasRotate = false;
        playMoveSound();
      }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => {
  initAudio();
  init();
});

document.getElementById('pause-resume-btn').addEventListener('click', togglePause);

document.getElementById('pause-restart-btn').addEventListener('click', () => {
  initAudio();
  init();
  blurFocused();
});

document.getElementById('pause-controls-btn').addEventListener('click', () => {
  pauseMain.classList.add('hidden');
  pauseKeys.classList.remove('hidden');
});

document.getElementById('pause-keys-back').addEventListener('click', showPauseMain);

pauseStartLevel.addEventListener('change', () => {
  startLevel = Number(pauseStartLevel.value);
});

canvas.addEventListener('click', initAudio);

const themeToggle = document.getElementById('theme-toggle');
const toggleIcon = themeToggle.querySelector('.toggle-icon');
const toggleLabel = themeToggle.querySelector('.toggle-label');

function applyTheme(isLight) {
  if (isLight) {
    document.body.classList.add('light-mode');
    toggleIcon.textContent = '☀';
    toggleLabel.textContent = 'DARK';
  } else {
    document.body.classList.remove('light-mode');
    toggleIcon.textContent = '☾';
    toggleLabel.textContent = 'LIGHT';
  }
}

const savedTheme = localStorage.getItem('tetris-theme');
applyTheme(savedTheme === 'light');

themeToggle.addEventListener('click', () => {
  const isLight = !document.body.classList.contains('light-mode');
  applyTheme(isLight);
  localStorage.setItem('tetris-theme', isLight ? 'light' : 'dark');
});

// ---- Tabla de records ----
const RECORDS_KEY = 'tetris-records';
const MAX_RECORDS = 5;
const recordsBody = document.getElementById('records-body');
const recordsReset = document.getElementById('records-reset');
const overlayRecords = document.getElementById('overlay-records');
const overlayRecordsBody = document.getElementById('overlay-records-body');
const recordForm = document.getElementById('record-form');
const recordName = document.getElementById('record-name');

let records = loadRecords();
let lastRecordEntry = null;
let pendingRecord = null;

function loadRecords() {
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (data && Array.isArray(data.top)) {
      return {
        top: data.top
          .filter(e => e && typeof e.score === 'number')
          .slice(0, MAX_RECORDS)
          .map(e => ({
            name: String(e.name ?? '').slice(0, 12),
            score: e.score,
            lines: Number(e.lines) || 0,
            combo: Number(e.combo) || 0,
          })),
        bestCombo: Number(data.bestCombo) || 0,
        maxLines: Number(data.maxLines) || 0,
      };
    }
  } catch {
    // Storage bloqueado o JSON corrupto: se empieza desde cero
  }
  return { top: [], bestCombo: 0, maxLines: 0 };
}

function saveRecords() {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Storage bloqueado: los records solo viven en memoria
  }
}

function recEl(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderRecordsInto(container, highlight) {
  container.textContent = '';
  const stats = recEl('div', 'rec-stats');
  stats.append(
    recEl('span', null, `MEJOR COMBO x${records.bestCombo}`),
    recEl('span', null, `LÍNEAS MÁX ${records.maxLines}`),
  );
  container.append(stats);

  if (records.top.length === 0) {
    container.append(recEl('p', 'rec-empty', 'Sin records todavía'));
    return;
  }

  const table = recEl('table', 'rec-table');
  const head = recEl('tr');
  ['#', 'NOMBRE', 'PUNTOS', 'LÍN', 'COMBO'].forEach(t => head.append(recEl('th', null, t)));
  table.append(head);

  records.top.forEach((e, i) => {
    const row = recEl('tr', e === highlight ? 'rec-own' : null);
    row.append(
      recEl('td', null, String(i + 1)),
      recEl('td', null, e.name),
      recEl('td', null, e.score.toLocaleString()),
      recEl('td', null, String(e.lines)),
      recEl('td', null, `x${e.combo}`),
    );
    table.append(row);
  });
  container.append(table);
}

function renderRecords() {
  renderRecordsInto(recordsBody, lastRecordEntry);
  renderRecordsInto(overlayRecordsBody, lastRecordEntry);
}

function handleGameOverRecords() {
  records.bestCombo = Math.max(records.bestCombo, gameBestCombo);
  records.maxLines = Math.max(records.maxLines, lines);

  const top = records.top;
  const qualifies = score > 0 && (top.length < MAX_RECORDS || score > top[top.length - 1].score);
  pendingRecord = qualifies ? { score, lines, combo: gameBestCombo } : null;
  recordForm.classList.toggle('hidden', !qualifies);
  if (qualifies) {
    recordName.value = '';
    recordName.focus();
  }

  overlayRecords.classList.remove('hidden');
  saveRecords();
  renderRecords();
}

recordForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!pendingRecord) return;
  const entry = { name: recordName.value.trim().slice(0, 12) || 'JUGADOR', ...pendingRecord };
  records.top.push(entry);
  records.top.sort((a, b) => b.score - a.score);
  records.top = records.top.slice(0, MAX_RECORDS);
  lastRecordEntry = entry;
  pendingRecord = null;
  recordForm.classList.add('hidden');
  saveRecords();
  renderRecords();
});

recordsReset.addEventListener('click', () => {
  if (!confirm('¿Resetear todos los records? Esta acción no se puede deshacer.')) return;
  records = { top: [], bestCombo: 0, maxLines: 0 };
  lastRecordEntry = null;
  pendingRecord = null;
  recordForm.classList.add('hidden');
  saveRecords();
  renderRecords();
});

renderRecords();

const skinSelect = document.getElementById('skin-select');

function applySkinClass(name) {
  for (const key of Object.keys(SKINS)) document.body.classList.remove(`skin-${key}`);
  document.body.classList.add(`skin-${name}`);
}

currentSkin = loadSavedSkin();
skinSelect.value = currentSkin;
applySkinClass(currentSkin);

skinSelect.addEventListener('change', () => {
  currentSkin = SKINS[skinSelect.value] ? skinSelect.value : 'retro';
  applySkinClass(currentSkin);
  try {
    localStorage.setItem('tetris-skin', currentSkin);
  } catch {
    // Storage unavailable
  }
  skinSelect.blur();
  draw();
  drawNext();
});

init();
