/* Кот-пилот: котик-супергерой пролетает между препятствиями над регионами России.
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
  var MENU_Y = 300;
  var MENU_ZOOM = 2;       // на заставке котик крупно и по центру
  var INTRO_TIME = 0.9;    // за сколько секунд он отлетает на своё место слева
  var CARD_HINT_EVERY = 5000; // раз в столько мс над открыткой появляется рука «нажми»
  var CARD_HINT_SHOW = 2600;  // рука видна два нажатия подряд
  var COUNTDOWN = 3;          // секунд отсчёта после открытки
  var CARD_TAP_GUARD = 800;   // первые мс открытка не закрывается: ребёнок ещё жмёт, чтобы котик летел

  /* Круги, которыми котик сталкивается: туловище, голова, передние лапы. Хвост и плащ не считаются. */
  var HITBOX = [[0, 0, 9], [22, -17, 12.5], [27, 5, 6]];

  function $(id) { return document.getElementById(id); }

  var canvas = $('game');
  var ctx = canvas.getContext('2d');
  var ui = {
    hud: $('hud'),
    scoreValue: $('score-value'),
    corner: $('corner'),
    btnMenu: $('btn-menu'),
    menuTitle: $('menu-title'),
    menuText: $('menu-text'),
    btnResume: $('btn-resume'),
    btnRestart: $('btn-restart'),
    btnSound: $('btn-sound'),
    hint: $('hint'),
    banner: $('banner'),
    bannerName: $('banner-name'),
    countdown: $('countdown'),
    countdownNum: $('countdown-num'),
    loading: $('loading'),
    cardMedia: $('card-media'),
    cardImage: $('card-image'),
    cardTitle: $('card-title'),
    cardText: $('card-text'),
    cardPanel: $('card-panel'),
    crashScore: $('crash-score'),
    crashScoreLabel: $('crash-score-label'),
    crashBest: $('crash-best'),
    btnContinue: $('btn-continue'),
    winText: $('win-text'),
    winCollection: $('win-collection'),
    btnShare: $('btn-share')
  };
  var screens = {
    card: $('screen-card'),
    pause: $('screen-pause'),
    crash: $('screen-crash'),
    win: $('screen-win')
  };

  /* Та же рука, что на заставке, но тыкает в центр открытки: открытка закрывается нажатием. */
  var cardHint = ui.hint.cloneNode(true);
  cardHint.removeAttribute('id');
  cardHint.removeAttribute('role');
  cardHint.removeAttribute('aria-label');
  cardHint.setAttribute('aria-hidden', 'true');
  cardHint.className = 'hint card-hint';
  ui.cardPanel.appendChild(cardHint);

  var content = null;
  var cards = [];          // все открытки подряд: { region, card, at }
  var regionStarts = [];   // с какого счёта начинается каждый регион
  var maxScore = 0;

  var scale = 1;
  var W = 360;
  var cssK = 1;            // CSS-пикселей в единице мира
  var playX = 100;         // где котик держится во время полёта
  var topLimit = null;     // верхняя граница просветов: ниже плашки счёта

  var state = 'loading';   // menu, intro, ready, countdown, play, card, pause, crashing, crash, win
  var currentScreen = null;
  var score = 0;
  var best = 0;
  var checkpoint = 0;
  var regionIdx = 0;
  var collected = [];
  var pending = [];
  var cardMode = 'game';
  var cardReturn = null;
  var menuReturn = null;   // откуда открыли меню вне полёта: { state, screen }
  var cardOpenedAt = 0;
  var cardHintTimer = 0;
  var cardHintHide = 0;
  var obstacles = [];
  var coins = [];
  var particles = [];
  var floaters = [];
  var plane = {
    x: 100, y: MENU_Y, vy: 0, rot: 0, baseY: START_Y, zoom: MENU_ZOOM,
    lastY: MENU_Y, cape: { x: 0, v: 0 }, legs: { x: 0, v: 0 },
    gone: false            // исчез в дыму после удара, пока не начнётся новый полёт
  };
  var pose = { cape: 0, legs: 0 };
  var intro = null;        // отлёт с заставки: откуда и сколько прошло
  var scrollX = 0;
  var distToNext = 0;
  var nextGapY = START_Y;
  var time = 0;
  var flash = 0;
  var transition = null;
  var crashTimer = 0;
  var bannerTimer = 0;
  var countdownLeft = 0;
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
    cssK = cssH / H;
    playX = clamp(W * 0.28, 70, 260);
    if (state !== 'menu' && !intro) plane.x = playX;
    topLimit = null;
    Art.setup(scale, W);
    if (content) Art.release([sceneOf(regionIdx)]);
    placeHint();
  }

  /* Нижний край плашки счёта в координатах мира: просветы не прячутся под неё. */
  function topMargin() {
    if (topLimit !== null) return topLimit;
    var rect = ui.hud.getBoundingClientRect();
    if (!rect.height) return 95;
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
    if (name !== 'card') stopCardHint();
    Object.keys(screens).forEach(function (key) { screens[key].hidden = key !== name; });
    if (name && screens[name]) screens[name].scrollTop = 0;
  }

  function setState(next) {
    state = next;
    ui.corner.hidden = state === 'loading';
    ui.hint.hidden = state !== 'menu' && state !== 'ready';
    ui.countdown.hidden = state !== 'countdown';
    placeHint();
  }

  /* Рука-подсказка стоит под котиком и «нажимает» снизу: тап поднимает его вверх. */
  function placeHint() {
    if (ui.hint.hidden) return;
    var x = state === 'menu' ? W / 2 + 4 * MENU_ZOOM : playX + 6;
    var y = state === 'menu' ? MENU_Y + 34 * MENU_ZOOM : plane.baseY + 44;
    ui.hint.style.transform = 'translate(' + (x * cssK).toFixed(1) + 'px,' + (y * cssK).toFixed(1) + 'px)';
  }

  function updateHud(bump) {
    ui.scoreValue.textContent = score;
    ui.hud.setAttribute('aria-label', 'Очки: ' + score);
    if (bump) {
      ui.scoreValue.classList.remove('bump');
      void ui.scoreValue.offsetWidth;
      ui.scoreValue.classList.add('bump');
    }
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
        item.appendChild(media);
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
        item.appendChild(lock);
      }
      el.appendChild(item);
    });
  }

  /* ---------- ход игры ---------- */

  /* Заставка: котик крупно по центру, под ним рука «нажми». Названия региона здесь нет —
     оно появляется, когда котик долетит до стартовой позиции. */
  function enterMenu() {
    regionIdx = 0;
    score = 0;
    obstacles = [];
    coins = [];
    plane.vy = 0;
    plane.zoom = MENU_ZOOM;
    plane.x = W / 2;
    intro = null;
    updateHud(false);
    showScreen(null);
    setState('menu');
  }

  /* Тап по заставке: котик отдаляется и улетает на своё место слева, потом появляется название региона. */
  function startGame() {
    if (state !== 'menu') return;
    Sound.unlock();
    runStarted = true;
    checkpoint = 0;
    intro = { t: 0, x: plane.x, y: plane.y, zoom: plane.zoom, rot: plane.rot };
    setState('intro');
  }

  function stepIntro(dt) {
    intro.t = Math.min(1, intro.t + dt / INTRO_TIME);
    var t = intro.t;
    var k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    var arc = Math.sin(Math.PI * k);
    plane.x = intro.x + (playX - intro.x) * k;
    plane.y = intro.y + (START_Y - intro.y) * k - arc * 14;
    plane.zoom = intro.zoom + (1 - intro.zoom) * k;
    plane.rot = intro.rot * (1 - k) - arc * 0.08;
    if (t >= 1) {
      intro = null;
      plane.zoom = 1;
      resetRun(0);
    }
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
    plane.x = playX;
    plane.zoom = 1;
    plane.gone = false;
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
    ui.hint.setAttribute('aria-label', text);
    setState('ready');
  }

  function flap() {
    if (state === 'ready') setState('play');
    if (state !== 'play') return;
    plane.vy = FLAP_V;
    Sound.flap();
  }

  function inFlight() {
    return state === 'play' || state === 'ready' || state === 'countdown';
  }

  function pauseGame() {
    if (!inFlight()) return;
    showMenu(true);
  }

  /* Кнопка меню. В полёте это пауза; на заставке и на экранах открытки, проигрыша и финиша
     меню открывается поверх, а «Продолжить» возвращает туда, откуда его открыли. */
  function openMenu() {
    if (inFlight()) {
      pauseGame();
      return;
    }
    if (state === 'loading' || state === 'intro' || state === 'crashing' || state === 'pause') return;
    menuReturn = { state: state, screen: currentScreen };
    showMenu(false);
  }

  function showMenu(flying) {
    ui.menuTitle.textContent = flying ? 'Пауза' : 'Меню';
    ui.menuText.hidden = !flying;
    ui.btnResume.textContent = flying ? 'Продолжить полёт' : 'Продолжить';
    ui.btnRestart.hidden = state === 'menu';
    setState('pause');
    showScreen('pause');
  }

  function resumeGame() {
    Sound.resume();
    if (menuReturn) {
      var back = menuReturn;
      menuReturn = null;
      setState(back.state);
      showScreen(back.screen);
      if (back.screen === 'card') startCardHint();
      return;
    }
    showScreen(null);
    plane.baseY = plane.y;
    enterReady('Нажми, чтобы продолжить');
  }

  function restart() {
    menuReturn = null;
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
        crash();
        return;
      }
    }
    for (i = 0; i < obstacles.length; i++) {
      if (hitTest(obstacles[i], circles)) {
        crash();
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
    cardMode = viewOnly ? 'view' : 'game';
    if (!viewOnly) {
      setState('card');
      collected[k] = true;
      checkpoint = Math.max(checkpoint, entry.at);
      Sound.card();
      Bridge.vibrate();
    }
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
    showScreen('card');
    cardOpenedAt = Date.now();
    startCardHint();
    ui.cardPanel.focus({ preventScroll: true });
  }

  function startCardHint() {
    stopCardHint();
    cardHintTimer = setInterval(function () {
      cardHint.hidden = false;
      clearTimeout(cardHintHide);
      cardHintHide = setTimeout(function () { cardHint.hidden = true; }, CARD_HINT_SHOW);
    }, CARD_HINT_EVERY);
  }

  function stopCardHint() {
    clearInterval(cardHintTimer);
    clearTimeout(cardHintHide);
    cardHint.hidden = true;
  }

  /* Нажатие в любом месте открытки закрывает её. */
  function tapCard() {
    if (currentScreen !== 'card' || Date.now() - cardOpenedAt < CARD_TAP_GUARD) return;
    closeCard();
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
    startCountdown();
  }

  /* После открытки по центру экрана идёт отсчёт 3, 2, 1, и котик сам летит дальше.
     Нажатия во время отсчёта не считаются, чтобы не взлететь раньше времени. */
  function startCountdown() {
    plane.baseY = clamp(plane.y, 120, GROUND - 120);
    countdownLeft = COUNTDOWN;
    ui.countdown.style.setProperty('--region-color', content.regions[regionIdx].color);
    setState('countdown');
    showCount(COUNTDOWN);
  }

  function showCount(n) {
    ui.countdownNum.textContent = n;
    ui.countdownNum.classList.remove('tick');
    void ui.countdownNum.offsetWidth;
    ui.countdownNum.classList.add('tick');
    Sound.tick();
  }

  function stepCountdown(dt) {
    var shown = Math.ceil(countdownLeft);
    countdownLeft -= dt;
    if (countdownLeft <= 0) {
      setState('play');
      plane.vy = FLAP_V * 0.6;
      Sound.flap();
    } else if (Math.ceil(countdownLeft) !== shown) {
      showCount(Math.ceil(countdownLeft));
    }
  }

  function switchRegion(r) {
    var from = sceneOf(regionIdx);
    regionIdx = r;
    transition = from !== sceneOf(r) ? { from: from, t: 0 } : null;
    Art.prepare(sceneOf(r));
    updateHud(false);
    showBanner(r);
  }

  /* Удар: котик исчезает в облачке дыма — пух клубов по всей фигуре и несколько искр. */
  function crash() {
    crashTimer = 1.0;
    plane.gone = true;
    flash = 1;
    plane.vy = 0;
    best = Math.max(best, score);
    setState('crashing');
    Sound.hit();
    Bridge.vibrate();
    var spots = hitCircles();
    spots.push({ x: plane.x - 26, y: plane.y - 14, r: 10 }, { x: plane.x - 34, y: plane.y + 2, r: 8 });
    var cx = plane.x + 4;
    var cy = plane.y - 4;
    var i;
    for (i = 0; i < 20; i++) {
      var s = spots[i % spots.length];
      var a = Math.random() * Math.PI * 2;
      var x = s.x + Math.cos(a) * s.r * Math.random();
      var y = s.y + Math.sin(a) * s.r * Math.random();
      var dx = x - cx;
      var dy = y - cy;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var sp = 25 + Math.random() * 45;
      var life = 0.75 + Math.random() * 0.4;
      particles.push({
        kind: 'smoke', x: x, y: y, vx: dx / len * sp, vy: dy / len * sp - 18,
        life: life, max: life, size: 10 + Math.random() * 6, grow: 10 + Math.random() * 8
      });
    }
    for (i = 0; i < 8; i++) {
      var b = Math.random() * Math.PI * 2;
      var v = 90 + Math.random() * 70;
      particles.push({
        kind: 'spark', x: cx, y: cy, vx: Math.cos(b) * v, vy: Math.sin(b) * v,
        life: 0.45, max: 0.45, size: 2 + Math.random() * 1.5, color: i % 2 ? '#ffffff' : '#ffe36b'
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

  /* ---------- поделиться ---------- */

  /* Системное «поделиться» через приложение: текст и квадратная картинка с собранными открытками.
     Картинка рисуется из своих же файлов, без сети. Если собрать её не вышло — уходит только текст. */
  var SHARE_SIZE = 900;
  var SHARE_FONT = 'system-ui, -apple-system, "SF Pro Display", Roboto, "Segoe UI", sans-serif';

  function shareGame() {
    if (ui.btnShare.disabled) return;
    ui.btnShare.disabled = true;
    var got = cards.filter(function (entry, k) { return collected[k]; });
    loadImages(got.map(function (entry) { return entry.card.image; }), function (imgs) {
      var image = null;
      try {
        image = drawShareImage(imgs, got.length).toDataURL('image/png');
      } catch (e) { /* холст не отдаёт картинку — поделимся текстом */ }
      Bridge.share(shareText(got.length), image);
      ui.btnShare.disabled = false;
    });
  }

  /* Без «долетел/долетела»: играют и мальчики, и девочки. */
  function cardsLine(n) {
    return (n === cards.length ? 'Все ' : '') + n + ' ' + plural(n, ['открытка', 'открытки', 'открыток']) +
      ' о чудесах России ' + (n === 1 ? 'собрана' : 'собраны');
  }

  function shareText(n) {
    return 'Маршрут в игре «' + content.title + '» пройден! ' + cardsLine(n) + '. Попробуй и ты.';
  }

  function loadImages(srcs, done) {
    var imgs = [];
    var left = srcs.length;
    if (!left) {
      done(imgs);
      return;
    }
    srcs.forEach(function (src, i) {
      var img = new Image();
      img.onload = img.onerror = function () {
        imgs[i] = img.naturalWidth ? img : null;
        if (--left === 0) done(imgs);
      };
      if (src) img.src = src; else img.onerror();
    });
  }

  function roundRectPath(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* Надпись как название региона: белая, с объёмной синей тенью снизу. */
  function heroText(g, text, x, y, depth) {
    g.fillStyle = '#1F6FE0';
    for (var d = depth; d > 0; d -= 2) g.fillText(text, x, y + d);
    g.fillStyle = '#ffffff';
    g.fillText(text, x, y);
  }

  function drawShareImage(imgs, n) {
    var S = SHARE_SIZE;
    var c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    var g = c.getContext('2d');
    var i;

    var sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, '#2F9BFF');
    sky.addColorStop(1, '#9FE2FF');
    g.fillStyle = sky;
    g.fillRect(0, 0, S, S);
    g.save();
    g.translate(S * 0.5, S * 0.1);
    g.fillStyle = 'rgba(255,255,255,0.1)';
    for (i = 0; i < 14; i++) {
      g.rotate(Math.PI * 2 / 14);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(S * 1.3, -50);
      g.lineTo(S * 1.3, 50);
      g.closePath();
      g.fill();
    }
    g.restore();

    g.textAlign = 'center';
    g.font = '900 70px ' + SHARE_FONT;
    heroText(g, 'Маршрут пройден!', S / 2, 122, 8);
    g.font = '700 34px ' + SHARE_FONT;
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillText(cardsLine(n), S / 2, 182);

    // открытки в белых рамках, по три в ряд, чуть наклонены
    var cols = 3;
    var tw = 228;
    var th = 137;
    var pad = 10;
    var gap = 26;
    var cw = tw + pad * 2;
    var x0 = (S - cols * cw - (cols - 1) * gap) / 2;
    imgs.forEach(function (img, k) {
      var x = x0 + (k % cols) * (cw + gap) + cw / 2;
      var y = 232 + Math.floor(k / cols) * (th + pad * 2 + gap) + th / 2 + pad;
      g.save();
      g.translate(x, y);
      g.rotate((k % 2 ? 2 : -2) * Math.PI / 180);
      g.shadowColor = 'rgba(10,40,120,0.3)';
      g.shadowBlur = 16;
      g.shadowOffsetY = 6;
      g.fillStyle = '#ffffff';
      roundRectPath(g, -cw / 2, -th / 2 - pad, cw, th + pad * 2, 18);
      g.fill();
      g.shadowColor = 'transparent';
      roundRectPath(g, -tw / 2, -th / 2, tw, th, 12);
      g.clip();
      g.fillStyle = '#E4EBF0';
      g.fillRect(-tw / 2, -th / 2, tw, th);
      if (img) {
        var k2 = Math.max(tw / img.naturalWidth, th / img.naturalHeight);
        var iw = img.naturalWidth * k2;
        var ih = img.naturalHeight * k2;
        g.drawImage(img, -iw / 2, -ih / 2, iw, ih);
      }
      g.restore();
    });

    // котик-супергерой и название игры
    Art.drawHero(g, S * 0.3, S * 0.8, -0.08, 0.35, 3.2, null);
    g.font = '900 50px ' + SHARE_FONT;
    heroText(g, content.title, S * 0.73, S * 0.79, 6);
    g.font = '700 28px ' + SHARE_FONT;
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillText(content.subtitle, S * 0.73, S * 0.79 + 46);
    return c;
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
      plane.x = W / 2;
      plane.y += (MENU_Y + Math.sin(time * 2) * 10 - plane.y) * Math.min(1, dt * 4);
      plane.rot = Math.cos(time * 2) * 0.06;
    } else if (state === 'intro') {
      scrollX += speed * (0.7 + 0.8 * Math.sin(Math.PI * intro.t)) * dt;
      stepIntro(dt);
    } else if (state === 'ready' || state === 'countdown') {
      if (!obstacles.length) scrollX += speed * dt;
      plane.y += (plane.baseY + Math.sin(time * 3) * 6 - plane.y) * Math.min(1, dt * 4);
      plane.rot += (Math.cos(time * 3) * 0.05 - plane.rot) * Math.min(1, dt * 6);
      if (state === 'countdown') stepCountdown(dt);
    } else if (state === 'play') {
      var left = dt;
      while (left > 0 && state === 'play') {
        var step = Math.min(MAX_STEP, left);
        stepPlay(step);
        left -= step;
      }
    } else if (state === 'crashing') {
      crashTimer -= dt;
      if (crashTimer <= 0) showCrash();
    }
    stepPose(dt);

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
      if (p.kind === 'smoke') {
        var drag = 1 - Math.min(1, dt * 3);
        p.vx *= drag;
        p.vy = p.vy * drag - 14 * dt;
        p.size += dt * p.grow;
      }
    }
    for (i = floaters.length - 1; i >= 0; i--) {
      floaters[i].life -= dt;
      floaters[i].y -= 34 * dt;
      if (floaters[i].life <= 0) floaters.splice(i, 1);
    }
  }

  /* Плащ и лапы — на пружинах: догоняют отклонение, которое задаёт вертикальная скорость котика.
     Рывок вверх — отстают и уходят вниз, падение — приподнимаются. Плащ лёгкий и качается дольше,
     лапы тяжелее: догоняют быстрее и почти без перехлёста.
     k — жёсткость (чем больше, тем быстрее догоняет), c — затухание (чем меньше, тем дольше качается). */
  var CAPE_SPRING = { k: 140, c: 11 };
  var LEG_SPRING = { k: 200, c: 18 };
  function stepPose(dt) {
    if (dt <= 0) return;
    var vy = (plane.y - plane.lastY) / dt;
    plane.lastY = plane.y;
    var target = clamp(vy / FLAP_V * 1.3, -0.6, 1.2);
    spring(plane.cape, target, CAPE_SPRING, dt);
    spring(plane.legs, target, LEG_SPRING, dt);
  }

  function spring(s, target, p, dt) {
    s.v += (p.k * (target - s.x) - p.c * s.v) * dt;
    s.x += s.v * dt;
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
    if (!plane.gone) {
      pose.cape = plane.cape.x;
      pose.legs = plane.legs.x;
      Art.drawHero(ctx, plane.x, plane.y, plane.rot, time, plane.zoom, pose);
    }

    drawSmoke();
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      if (p.kind === 'smoke') continue;
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

  /* Дым в два прохода: сначала сиреневые тени всех клубов, потом светлые клубы поверх —
     облако выглядит цельным, с объёмом снизу. */
  function drawSmoke() {
    for (var pass = 0; pass < 2; pass++) {
      ctx.fillStyle = pass ? '#F7F5FF' : 'rgba(150,140,195,0.5)';
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (p.kind !== 'smoke') continue;
        ctx.globalAlpha = Math.min(1, p.life / p.max * 2);
        var r = pass ? p.size * 0.86 : p.size;
        ctx.beginPath();
        ctx.arc(p.x + (pass ? -0.08 : 0.18) * p.size, p.y + (pass ? -0.1 : 0.22) * p.size, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
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
    if (state === 'menu') startGame();
    else if (state === 'ready' || state === 'play') flap();
  });

  document.addEventListener('keydown', function (e) {
    if (currentScreen === 'card' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape')) {
      e.preventDefault();
      tapCard();
    } else if (state === 'menu' && (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter')) {
      e.preventDefault();
      startGame();
    } else if (e.code === 'Space' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (state === 'ready' || state === 'play') flap();
    } else if (e.code === 'Escape' || e.code === 'KeyP') {
      if (state === 'pause') resumeGame(); else openMenu();
    }
  });

  screens.card.addEventListener('click', tapCard);
  ui.btnContinue.addEventListener('click', continueRun);
  ui.btnShare.addEventListener('click', shareGame);
  ui.btnMenu.addEventListener('click', openMenu);
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
  /* Заставка открывается, когда готовы и контент, и кадры котика. */
  var loadsLeft = 2;
  function loaded() {
    if (--loadsLeft) return;
    ui.loading.hidden = true;
    enterMenu();
  }
  Content.load(function (c) {
    setupContent(c);
    updateHud(false);
    loaded();
  });
  Art.load(loaded);

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
