/* Кот-пилот: самолётик пролетает между препятствиями над регионами России.
   Каждое препятствие — 1 очко, монетка — бонус, каждые pointsPerCard очков — открытка,
   после последней открытки региона меняется фон. Финал — когда собраны все открытки. */
(function () {
  'use strict';

  var H = Art.H;
  var GROUND = Art.GROUND;
  var OB_W = Art.OB_W;
  var GRAVITY = 1250;
  var FLAP_V = -390;
  var MAX_FALL = 560;
  var SPACING = 210;       // расстояние между препятствиями
  var BOTTOM_MARGIN = 50;
  var MAX_STEP = 1 / 120;  // шаг физики, чтобы столкновения не проскакивали
  var START_Y = 300;
  var MENU_Y = 230;
  var FONT = 'system-ui, -apple-system, "SF Pro Display", Roboto, "Segoe UI", sans-serif';

  /* Круги, которыми самолётик сталкивается: корпус, кот, нос. */
  var HITBOX = [[2, 0, 12], [1, -19, 10], [22, -1, 8]];

  function $(id) { return document.getElementById(id); }

  var canvas = $('game');
  var ctx = canvas.getContext('2d');
  var ui = {
    hud: $('hud'),
    scoreCanvas: $('score-canvas'),
    corner: $('corner'),
    btnClose: $('btn-close'),
    btnSound: $('btn-sound'),
    hint: $('hint'),
    banner: $('banner'),
    bannerName: $('banner-name'),
    loading: $('loading'),
    cardMedia: $('card-media'),
    cardImage: $('card-image'),
    cardTitle: $('card-title'),
    cardText: $('card-text'),
    btnCard: $('btn-card'),
    crashScore: $('crash-score'),
    crashScoreLabel: $('crash-score-label'),
    crashBest: $('crash-best'),
    btnContinue: $('btn-continue'),
    winText: $('win-text'),
    winCollection: $('win-collection')
  };
  var screens = {
    menu: $('screen-menu'),
    card: $('screen-card'),
    pause: $('screen-pause'),
    crash: $('screen-crash'),
    win: $('screen-win')
  };

  var content = null;
  var cards = [];          // все открытки подряд: { region, card, at }
  var regionStarts = [];   // с какого счёта начинается каждый регион
  var maxScore = 0;

  var scale = 1;
  var W = 360;
  var topLimit = null;     // верхняя граница просветов: ниже плашки счёта

  var state = 'loading';   // menu, ready, play, card, pause, crashing, crash, win
  var currentScreen = null;
  var score = 0;
  var best = 0;
  var checkpoint = 0;
  var regionIdx = 0;
  var collected = [];
  var pending = [];
  var cardMode = 'game';
  var cardReturn = null;
  var obstacles = [];
  var coins = [];
  var particles = [];
  var floaters = [];
  var plane = { x: 100, y: MENU_Y, vy: 0, rot: 0, baseY: START_Y };
  var scrollX = 0;
  var distToNext = 0;
  var nextGapY = START_Y;
  var time = 0;
  var flash = 0;
  var transition = null;
  var crashTimer = 0;
  var bannerTimer = 0;
  var runStarted = false;
  var finishSent = false;
  var lastFrame = 0;

  /* ---------- утилиты ---------- */

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function plural(n, forms) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function seeded(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
  }

  function sceneOf(index) { return content.regions[index].scene; }

  function regionForScore(s) {
    for (var i = regionStarts.length - 1; i >= 0; i--) {
      if (s >= regionStarts[i]) return i;
    }
    return 0;
  }

  /* ---------- размеры ---------- */

  function resize() {
    var cssW = window.innerWidth || document.documentElement.clientWidth;
    var cssH = window.innerHeight || document.documentElement.clientHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    scale = canvas.height / H;
    W = canvas.width / scale;
    plane.x = clamp(W * 0.28, 70, 260);
    topLimit = null;
    Art.setup(scale, W);
    if (content) Art.release([sceneOf(regionIdx)]);
  }

  /* Нижний край плашки счёта в координатах мира: просветы не прячутся под неё. */
  function topMargin() {
    if (topLimit !== null) return topLimit;
    var rect = ui.hud.hidden ? null : ui.hud.getBoundingClientRect();
    if (!rect || !rect.height) return 95;
    topLimit = clamp(rect.bottom / (window.innerHeight || 1) * H + 14, 90, 200);
    return topLimit;
  }

  /* ---------- контент ---------- */

  function setupContent(c) {
    content = c;
    cards = [];
    regionStarts = [];
    var total = 0;
    c.regions.forEach(function (region, ri) {
      regionStarts.push(total * c.pointsPerCard);
      region.cards.forEach(function (card) {
        total++;
        cards.push({ region: ri, card: card, at: total * c.pointsPerCard });
      });
    });
    maxScore = total * c.pointsPerCard;
    collected = cards.map(function () { return false; });

    cards.forEach(function (entry) {
      if (entry.card.image) {
        var img = new Image();
        img.src = entry.card.image;
      }
    });

    document.title = c.title + ': ' + c.subtitle.toLowerCase();
  }

  /* ---------- интерфейс ---------- */

  function showScreen(name) {
    currentScreen = name;
    Object.keys(screens).forEach(function (key) { screens[key].hidden = key !== name; });
    if (name && screens[name]) screens[name].scrollTop = 0;
  }

  function setState(next) {
    state = next;
    ui.hud.hidden = state === 'menu' || state === 'loading';
    ui.corner.hidden = state === 'loading';
    ui.hint.hidden = state !== 'ready';
  }

  function updateHud(bump) {
    drawScore();
    if (bump) {
      ui.scoreCanvas.classList.remove('bump');
      void ui.scoreCanvas.offsetWidth;
      ui.scoreCanvas.classList.add('bump');
    }
  }

  /* Счёт как будто нарисован восковым карандашом: яркая неровная обводка с зерном,
     белая заливка и тонкий карандашный контур. Максимум очков не показываем. */
  function drawScore() {
    var c = ui.scoreCanvas;
    var g = c.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = 60;
    var text = String(score);
    var font = '900 ' + size + 'px ' + FONT;
    g.font = font;
    var tw = g.measureText(text).width;
    var w = Math.ceil(tw + 36);
    var h = Math.ceil(size * 1.3);
    c.width = w * dpr;
    c.height = h * dpr;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    var x = w / 2;
    var y = h / 2 + size * 0.04;
    var rand = seeded(score * 7919 + 17);
    var i;

    var crayon = g.createLinearGradient(x - tw / 2, y - size / 2, x + tw / 2, y + size / 2);
    crayon.addColorStop(0, '#FF9F1C');
    crayon.addColorStop(0.5, '#FF4F8B');
    crayon.addColorStop(1, '#9B6BFF');
    g.strokeStyle = crayon;
    g.shadowColor = 'rgba(20, 20, 40, 0.3)';
    g.shadowBlur = 6;
    g.shadowOffsetY = 2;
    for (i = 0; i < 4; i++) {
      g.globalAlpha = 0.6;
      g.lineWidth = 11 + rand() * 3;
      g.strokeText(text, x + (rand() - 0.5) * 3, y + (rand() - 0.5) * 3);
    }
    g.shadowColor = 'transparent';
    g.globalCompositeOperation = 'destination-out';
    for (i = 0; i < 170; i++) {
      g.globalAlpha = 0.25 + rand() * 0.35;
      g.beginPath();
      g.arc(rand() * w, rand() * h, 0.5 + rand() * 0.9, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.fillText(text, x, y);
    g.strokeStyle = '#2A2340';
    g.lineWidth = 1.4;
    for (i = 0; i < 2; i++) {
      g.globalAlpha = 0.7;
      g.strokeText(text, x + (rand() - 0.5) * 1.6, y + (rand() - 0.5) * 1.6);
    }
    g.globalAlpha = 1;
    c.setAttribute('aria-label', 'Очки: ' + score);
  }

  function showBanner(index) {
    var region = content.regions[index];
    ui.banner.style.setProperty('--region-color', region.color);
    ui.bannerName.textContent = region.name;
    ui.banner.hidden = true;
    void ui.banner.offsetWidth;
    ui.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { ui.banner.hidden = true; }, 2300);
  }

  function updateSoundButton() {
    var on = Sound.isEnabled();
    ui.btnSound.classList.toggle('off', !on);
    ui.btnSound.setAttribute('aria-label', on ? 'Выключить звук' : 'Включить звук');
  }

  function renderCollection(el) {
    el.innerHTML = '';
    cards.forEach(function (entry, k) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'thumb';
      if (collected[k]) {
        var media = document.createElement('div');
        media.className = 'thumb-media';
        if (entry.card.image) {
          var img = document.createElement('img');
          img.alt = '';
          img.src = entry.card.image;
          media.appendChild(img);
        }
        var label = document.createElement('span');
        label.className = 'thumb-title';
        label.textContent = entry.card.title;
        item.appendChild(media);
        item.appendChild(label);
        item.setAttribute('aria-label', 'Открытка: ' + entry.card.title);
        item.addEventListener('click', function () {
          cardReturn = currentScreen;
          openCard(k, true);
        });
      } else {
        item.className += ' locked';
        item.disabled = true;
        item.setAttribute('aria-label', 'Открытка ещё не найдена');
        var lock = document.createElement('div');
        lock.className = 'thumb-media';
        var question = document.createElement('span');
        question.className = 'thumb-q';
        question.textContent = '?';
        lock.appendChild(question);
        var hidden = document.createElement('span');
        hidden.className = 'thumb-title';
        hidden.textContent = content.regions[entry.region].name;
        item.appendChild(lock);
        item.appendChild(hidden);
      }
      el.appendChild(item);
    });
  }

  /* ---------- ход игры ---------- */

  function enterMenu() {
    regionIdx = 0;
    score = 0;
    obstacles = [];
    coins = [];
    plane.vy = 0;
    setState('menu');
    showScreen('menu');
  }

  function startGame() {
    Sound.unlock();
    runStarted = true;
    checkpoint = 0;
    resetRun(0);
  }

  function resetRun(startScore) {
    score = startScore;
    obstacles = [];
    coins = [];
    floaters = [];
    pending = [];
    var r = regionForScore(score);
    if (r !== regionIdx) {
      regionIdx = r;
      transition = null;
      Art.release([sceneOf(r)]);
    }
    plane.vy = 0;
    plane.rot = 0;
    plane.baseY = START_Y;
    distToNext = 0;
    nextGapY = START_Y;
    updateHud(false);
    showScreen(null);
    showBanner(regionIdx);
    enterReady(startScore === 0 ? 'Нажми, чтобы взлететь' : 'Нажми, чтобы лететь дальше');
  }

  function enterReady(text) {
    plane.baseY = clamp(plane.baseY, 120, GROUND - 120);
    ui.hint.textContent = text;
    setState('ready');
  }

  function flap() {
    if (state === 'ready') setState('play');
    if (state !== 'play') return;
    plane.vy = FLAP_V;
    Sound.flap();
  }

  function pauseGame() {
    if (state !== 'play' && state !== 'ready') return;
    setState('pause');
    showScreen('pause');
  }

  function resumeGame() {
    showScreen(null);
    Sound.resume();
    plane.baseY = plane.y;
    enterReady('Нажми, чтобы продолжить');
  }

  function restart() {
    Sound.unlock();
    checkpoint = 0;
    resetRun(0);
  }

  function continueRun() {
    Sound.unlock();
    resetRun(checkpoint);
  }

  function exitGame() {
    if (runStarted && !finishSent) {
      finishSent = true;
      Bridge.finish();
    }
    Bridge.close();
  }

  function gapLimits() {
    var gap = content.regions[regionIdx].gap;
    return { gap: gap, min: topMargin() + gap / 2, max: GROUND - BOTTOM_MARGIN - gap / 2 };
  }

  function spawnObstacle() {
    var region = content.regions[regionIdx];
    var lim = gapLimits();
    var gy = clamp(nextGapY, lim.min, lim.max);
    var next = clamp(gy + (Math.random() * 2 - 1) * 150, lim.min, lim.max);
    var x = W + 30 + distToNext;
    obstacles.push({
      x: x,
      gapTop: gy - lim.gap / 2,
      gapBottom: gy + lim.gap / 2,
      style: region.obstacle,
      inset: region.obstacle === 'rock' ? 6 : 2,
      passed: false
    });
    // Монетка — между этим препятствием и следующим, на высоте между их просветами
    if (Math.random() < content.coin.chance) {
      coins.push({
        x: x + OB_W / 2 + SPACING / 2,
        y: (gy + next) / 2 + (Math.random() * 2 - 1) * 18,
        phase: Math.random() * 6
      });
    }
    nextGapY = next;
    distToNext += SPACING;
  }

  function circleHitsRect(cx, cy, r, x, y, w, h) {
    if (w <= 0 || h <= 0) return false;
    var nx = clamp(cx, x, x + w);
    var ny = clamp(cy, y, y + h);
    var dx = cx - nx;
    var dy = cy - ny;
    return dx * dx + dy * dy < r * r;
  }

  function hitCircles() {
    var cos = Math.cos(plane.rot);
    var sin = Math.sin(plane.rot);
    return HITBOX.map(function (c) {
      return { x: plane.x + c[0] * cos - c[1] * sin, y: plane.y + c[0] * sin + c[1] * cos, r: c[2] };
    });
  }

  function hitTest(o, circles) {
    var x = o.x + o.inset;
    var w = OB_W - o.inset * 2;
    for (var i = 0; i < circles.length; i++) {
      var c = circles[i];
      if (circleHitsRect(c.x, c.y, c.r, x, 0, w, o.gapTop)) return 'top';
      if (circleHitsRect(c.x, c.y, c.r, x, o.gapBottom, w, GROUND - o.gapBottom)) return 'bottom';
    }
    return null;
  }

  function stepPlay(dt) {
    var region = content.regions[regionIdx];
    plane.vy = Math.min(plane.vy + GRAVITY * dt, MAX_FALL);
    plane.y += plane.vy * dt;
    if (plane.y < 14) {
      plane.y = 14;
      if (plane.vy < 0) plane.vy = 0;
    }
    var target = plane.vy < 0 ? -0.32 : Math.min(plane.vy / MAX_FALL, 1) * 0.85;
    plane.rot += (target - plane.rot) * Math.min(1, dt * 9);

    var dx = region.speed * dt;
    scrollX += dx;
    distToNext -= dx;
    var i;
    for (i = 0; i < obstacles.length; i++) obstacles[i].x -= dx;
    for (i = 0; i < coins.length; i++) coins[i].x -= dx;
    if (distToNext <= 0) spawnObstacle();

    var circles = hitCircles();
    for (i = 0; i < circles.length; i++) {
      if (circles[i].y + circles[i].r >= GROUND) {
        crash('ground');
        return;
      }
    }
    for (i = 0; i < obstacles.length; i++) {
      var hit = hitTest(obstacles[i], circles);
      if (hit) {
        crash(hit);
        return;
      }
    }

    for (i = 0; i < coins.length; i++) {
      var coin = coins[i];
      if (coin.taken) continue;
      var cx = coin.x - plane.x;
      var cy = coin.y - plane.y;
      if (cx * cx + cy * cy < 26 * 26 || cx * cx + (cy + 18) * (cy + 18) < 20 * 20) {
        coin.taken = true;
        collectCoin(coin);
        if (state !== 'play') return;
      }
    }

    for (i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (!o.passed && o.x + OB_W < plane.x - 6) {
        o.passed = true;
        Sound.point();
        addPoints(1);
        if (state !== 'play') return;
      }
    }

    obstacles = obstacles.filter(function (ob) { return ob.x + OB_W + 12 > 0; });
    coins = coins.filter(function (cn) { return !cn.taken && cn.x > -30; });
  }

  function collectCoin(coin) {
    var value = content.coin.value;
    Sound.coin();
    for (var i = 0; i < 10; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 40 + Math.random() * 90;
      particles.push({
        kind: 'spark', x: coin.x, y: coin.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5, max: 0.5, size: 2 + Math.random() * 2, color: '#ffe36b'
      });
    }
    floaters.push({ x: coin.x, y: coin.y - 14, text: '+' + value, life: 0.9, max: 0.9 });
    addPoints(value);
  }

  function addPoints(n) {
    var old = score;
    score = Math.min(maxScore, score + n);
    if (score === old) return;
    updateHud(true);
    if (score >= maxScore) Bridge.completed();
    for (var k = 0; k < cards.length; k++) {
      if (old < cards[k].at && score >= cards[k].at) pending.push(k);
    }
    if (pending.length) openCard(pending.shift(), false);
  }

  function openCard(k, viewOnly) {
    var entry = cards[k];
    var region = content.regions[entry.region];
    cardMode = viewOnly ? 'view' : 'game';
    if (!viewOnly) {
      setState('card');
      collected[k] = true;
      checkpoint = Math.max(checkpoint, entry.at);
      Sound.card();
      Bridge.vibrate();
    }
    screens.card.querySelector('.panel').style.setProperty('--panel-color', region.color);
    ui.cardMedia.hidden = !entry.card.image;
    if (entry.card.image) ui.cardImage.src = entry.card.image;
    else ui.cardImage.removeAttribute('src');
    ui.cardTitle.textContent = entry.card.title;
    ui.cardText.innerHTML = '';
    entry.card.text.split(/\n\s*\n/).forEach(function (paragraph) {
      if (!paragraph.trim()) return;
      var p = document.createElement('p');
      p.textContent = paragraph.trim();
      ui.cardText.appendChild(p);
    });
    var label = 'Летим дальше!';
    if (viewOnly) {
      label = 'Закрыть';
    } else if (k === cards.length - 1) {
      label = 'К финишу!';
    } else if (cards[k + 1].region !== entry.region) {
      var nextRegion = content.regions[cards[k + 1].region];
      if (nextRegion.nameTo) label = 'Летим ' + nextRegion.nameTo + '!';
    }
    ui.btnCard.textContent = label;
    showScreen('card');
  }

  function closeCard() {
    if (cardMode === 'view') {
      showScreen(cardReturn);
      return;
    }
    if (pending.length) {
      openCard(pending.shift(), false);
      return;
    }
    if (score >= maxScore) {
      win();
      return;
    }
    showScreen(null);
    var r = regionForScore(score);
    if (r !== regionIdx) switchRegion(r);
    plane.baseY = plane.y;
    enterReady('Нажми, чтобы лететь дальше');
  }

  function switchRegion(r) {
    var from = sceneOf(regionIdx);
    regionIdx = r;
    transition = from !== sceneOf(r) ? { from: from, t: 0 } : null;
    Art.prepare(sceneOf(r));
    updateHud(false);
    showBanner(r);
  }

  function crash(reason) {
    crashTimer = 0.9;
    flash = 1;
    plane.vy = reason === 'top' ? 80 : -170;
    best = Math.max(best, score);
    setState('crashing');
    Sound.hit();
    Bridge.vibrate();
    for (var i = 0; i < 12; i++) {
      var a = Math.random() * Math.PI * 2;
      particles.push({
        kind: 'puff', x: plane.x, y: plane.y, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50 - 20,
        life: 0.7, max: 0.7, size: 6 + Math.random() * 6, color: 'rgba(255,255,255,0.8)'
      });
    }
  }

  /* Экран проигрыша — только очки, рекорд и одна кнопка. Повтор продолжает полёт
     с последней открытки, чтобы потеря прогресса не расстраивала. */
  function showCrash() {
    setState('crash');
    ui.crashScore.textContent = score;
    ui.crashScoreLabel.textContent = plural(score, ['очко', 'очка', 'очков']);
    ui.crashBest.textContent = best;
    showScreen('crash');
  }

  function win() {
    best = Math.max(best, score);
    setState('win');
    Bridge.completed();
    if (!finishSent) {
      finishSent = true;
      Bridge.finish();
    }
    Sound.win();
    ui.winText.textContent = 'Ты набрал ' + maxScore + ' ' + plural(maxScore, ['очко', 'очка', 'очков']) +
      ' и собрал все ' + cards.length + ' ' + plural(cards.length, ['открытку', 'открытки', 'открыток']) +
      '. Нажми на открытку, чтобы перечитать её.';
    renderCollection(ui.winCollection);
    showScreen('win');
    var colors = ['#ffd84d', '#3ccf62', '#4fb6ff', '#ff6b6b', '#ffffff', '#c86bff'];
    for (var i = 0; i < 110; i++) {
      particles.push({
        kind: 'confetti', x: Math.random() * W, y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 60, vy: 60 + Math.random() * 120, g: 60,
        rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10,
        life: 4, max: 4, size: 4 + Math.random() * 4, color: colors[i % colors.length]
      });
    }
  }

  /* ---------- кадр ---------- */

  function update(dt) {
    time += dt;
    if (flash > 0) flash = Math.max(0, flash - dt * 3);
    if (transition) {
      transition.t += dt / 1.2;
      if (transition.t >= 1) {
        transition = null;
        Art.release([sceneOf(regionIdx)]);
      }
    }
    var speed = content.regions[regionIdx].speed;

    if (state === 'menu') {
      scrollX += speed * 0.7 * dt;
      plane.y += (MENU_Y + Math.sin(time * 2) * 10 - plane.y) * Math.min(1, dt * 4);
      plane.rot = Math.cos(time * 2) * 0.06;
    } else if (state === 'ready') {
      if (!obstacles.length) scrollX += speed * dt;
      plane.y += (plane.baseY + Math.sin(time * 3) * 6 - plane.y) * Math.min(1, dt * 4);
      plane.rot += (Math.cos(time * 3) * 0.05 - plane.rot) * Math.min(1, dt * 6);
    } else if (state === 'play') {
      var left = dt;
      while (left > 0 && state === 'play') {
        var step = Math.min(MAX_STEP, left);
        stepPlay(step);
        left -= step;
      }
    } else if (state === 'crashing') {
      plane.vy = Math.min(plane.vy + GRAVITY * dt, MAX_FALL);
      plane.y = Math.min(plane.y + plane.vy * dt, GROUND - 12);
      plane.rot += (1.1 - plane.rot) * Math.min(1, dt * 5);
      crashTimer -= dt;
      if (crashTimer <= 0) showCrash();
    }

    var i;
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.g) p.vy += p.g * dt;
      if (p.vr) p.rot += p.vr * dt;
      if (p.kind === 'puff') p.size += dt * 18;
    }
    for (i = floaters.length - 1; i >= 0; i--) {
      floaters[i].life -= dt;
      floaters[i].y -= 34 * dt;
      if (floaters[i].life <= 0) floaters.splice(i, 1);
    }
  }

  function render() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    var scene = sceneOf(regionIdx);
    var fade = transition ? transition.t * transition.t * (3 - 2 * transition.t) : 1;
    if (transition) Art.drawBack(ctx, transition.from, scrollX, 1);
    Art.drawBack(ctx, scene, scrollX, fade);
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.x > W + 20) continue;
      Art.drawObstacle(ctx, o.style, o.x, o.gapTop, o.gapBottom);
    }
    if (transition) Art.drawGround(ctx, transition.from, scrollX, 1);
    Art.drawGround(ctx, scene, scrollX, fade);
    for (i = 0; i < coins.length; i++) {
      if (!coins[i].taken && coins[i].x < W + 20) Art.drawCoin(ctx, coins[i].x, coins[i].y, time + coins[i].phase);
    }
    Art.drawPlane(ctx, plane.x, plane.y, plane.rot, time);

    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.min(1, p.life / p.max * 1.5);
      ctx.fillStyle = p.color;
      if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (floaters.length) {
      ctx.font = '900 22px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(120,70,0,0.8)';
      ctx.fillStyle = '#fff6c8';
      for (i = 0; i < floaters.length; i++) {
        var f = floaters[i];
        ctx.globalAlpha = Math.min(1, f.life / f.max * 1.6);
        ctx.strokeText(f.text, f.x, f.y);
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
    }
    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (flash * 0.55).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!lastFrame) lastFrame = now;
    var dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
    if (state === 'loading') return;
    update(dt);
    render();
  }

  /* ---------- ввод ---------- */

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state === 'ready' || state === 'play') flap();
  });

  document.addEventListener('keydown', function (e) {
    if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (state === 'ready' || state === 'play') flap();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (state === 'pause') resumeGame(); else pauseGame();
    }
  });

  $('btn-start').addEventListener('click', startGame);
  ui.btnCard.addEventListener('click', closeCard);
  ui.btnContinue.addEventListener('click', continueRun);
  /* «Закрыть» во время полёта сначала ставит паузу: ребёнок часто жмёт и в угол экрана. */
  ui.btnClose.addEventListener('click', function () {
    if (state === 'play' || state === 'ready') pauseGame();
    else exitGame();
  });
  ui.btnSound.addEventListener('click', function () {
    Sound.unlock();
    Sound.setEnabled(!Sound.isEnabled());
    updateSoundButton();
  });

  document.addEventListener('click', function (e) {
    var target = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'resume') resumeGame();
    else if (action === 'restart') restart();
    else if (action === 'exit') exitGame();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      pauseGame();
      Sound.suspend();
    } else {
      Sound.resume();
    }
  });

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });

  /* ---------- старт ---------- */

  resize();
  updateSoundButton();
  requestAnimationFrame(frame);
  Content.load(function (c) {
    setupContent(c);
    updateHud(false);
    ui.loading.hidden = true;
    enterMenu();
  });

  /* Хук для автотестов: включается только параметром ?debug в адресе. */
  if (/[?&]debug\b/.test(location.search)) {
    window.KotPilotDebug = {
      get: function () {
        return {
          state: state, score: score, maxScore: maxScore, regionIdx: regionIdx, W: W,
          plane: { x: plane.x, y: plane.y, vy: plane.vy },
          obstacles: obstacles.map(function (o) { return { x: o.x, gapTop: o.gapTop, gapBottom: o.gapBottom, passed: o.passed }; }),
          coins: coins.map(function (c) { return { x: c.x, y: c.y }; })
        };
      },
      flap: flap
    };
  }
})();
