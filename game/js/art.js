/* Вся графика игры рисуется кодом на Canvas: фоны регионов, препятствия, котик-супергерой, монетки.
   Слои фона рисуются один раз в закадровые canvas и прокручиваются с параллаксом. */
(function () {
  'use strict';

  var H = 640;          // логическая высота мира
  var GROUND = 570;     // верх земли
  var TILE = 640;       // ширина повторяющегося куска фона
  var OB_W = 64;        // ширина препятствия (по ней считается столкновение)
  var CAP = 7;          // насколько шапка препятствия шире тела

  var scale = 1;
  var viewW = 360;
  // Ключи кэшей включают масштаб: игра и комикс в меню рисуются в разных размерах
  var sceneCache = {};
  var obstacleCache = {};

  function sceneKey(name) { return name + '|' + scale + '|' + viewW; }
  function obstacleKey(style) { return style + '|' + scale; }

  /* ---------- утилиты ---------- */

  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w));
    c.height = Math.max(1, Math.ceil(h));
    return c;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  function circle(g, x, y, r) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  function ellipse(g, x, y, rx, ry) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
  }

  function vGradient(g, y0, y1, stops) {
    var gr = g.createLinearGradient(0, y0, 0, y1);
    for (var i = 0; i < stops.length; i++) gr.addColorStop(stops[i][0], stops[i][1]);
    return gr;
  }

  /* Периодический профиль: точки по всей ширине тайла, интерполяция через край тайла. */
  function profile(rand, n, minY, maxY, smooth) {
    var pts = [];
    for (var i = 0; i < n; i++) pts.push(minY + rand() * (maxY - minY));
    return function (x) {
      var u = ((x % TILE) + TILE) % TILE / TILE * n;
      var i = Math.floor(u);
      var f = u - i;
      if (smooth) f = (1 - Math.cos(f * Math.PI)) / 2;
      var a = pts[i % n];
      var b = pts[(i + 1) % n];
      return a + (b - a) * f;
    };
  }

  function fillProfile(g, f, bottom) {
    g.beginPath();
    g.moveTo(0, bottom);
    for (var x = 0; x <= TILE; x += 4) g.lineTo(x, f(x));
    g.lineTo(TILE, bottom);
    g.closePath();
    g.fill();
  }

  /* Рисует объект и его копию с другой стороны тайла, если он выходит за край. */
  function wrapped(x, halfWidth, draw) {
    draw(x);
    if (x - halfWidth < 0) draw(x + TILE);
    if (x + halfWidth > TILE) draw(x - TILE);
  }

  /* Свободное место на повторяющейся полосе: x, при котором предмет полушириной half не задевает
     уже поставленные (taken: { x, half }) с зазором gap. Если места так и не нашлось — null. */
  function freeSpot(rand, taken, half, gap) {
    for (var tries = 0; tries < 40; tries++) {
      var x = rand() * TILE;
      var ok = true;
      for (var i = 0; i < taken.length && ok; i++) {
        var d = Math.abs(taken[i].x - x);
        ok = Math.min(d, TILE - d) > taken[i].half + half + gap;
      }
      if (ok) return x;
    }
    return null;
  }

  /* Свободно ли место под камешек: рамки с запасом не пересекаются ни с одним из уже положенных.
     Фон повторяется по ширине, поэтому расстояние по x считается через край плитки. */
  function stoneFits(stones, x, y, rx, ry) {
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      var dx = Math.abs(s.x - x);
      dx = Math.min(dx, TILE - dx);
      if (dx < s.rx + rx + 6 && Math.abs(s.y - y) < s.ry + ry + 4) return false;
    }
    return true;
  }

  function sun(g, x, y, r, glow, inner, outer) {
    var halo = g.createRadialGradient(x, y, r * 0.5, x, y, r * 3.2);
    halo.addColorStop(0, glow);
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = halo;
    circle(g, x, y, r * 3.2);
    var disk = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
    disk.addColorStop(0, inner);
    disk.addColorStop(1, outer);
    g.fillStyle = disk;
    circle(g, x, y, r);
  }

  function cloud(g, x, y, s, color, shade) {
    var parts = [[-30, 2, 15], [-12, -8, 19], [10, -14, 22], [32, -4, 17], [46, 4, 12], [8, 6, 16]];
    var i;
    g.fillStyle = shade;
    for (i = 0; i < parts.length; i++) circle(g, x + parts[i][0] * s, y + parts[i][1] * s + 5 * s, parts[i][2] * s);
    g.fillStyle = color;
    for (i = 0; i < parts.length; i++) circle(g, x + parts[i][0] * s, y + parts[i][1] * s, parts[i][2] * s);
  }

  function clouds(g, rand, count, minY, maxY, color, shade) {
    for (var i = 0; i < count; i++) {
      var x = rand() * TILE;
      var y = minY + rand() * (maxY - minY);
      var s = 0.6 + rand() * 0.6;
      wrapped(x, 80 * s, function (cx) { cloud(g, cx, y, s, color, shade); });
    }
  }

  function fir(g, x, base, h, color, snow) {
    var w = h * 0.42;
    var tiers = [[1, 0.55, 0.45], [0.78, 0.3, 0.6], [0.55, 0.06, 0.78]];
    g.fillStyle = '#4a3426';
    g.fillRect(x - w * 0.06, base - h * 0.1, w * 0.12, h * 0.1);
    for (var i = 0; i < tiers.length; i++) {
      var apex = base - h * tiers[i][0];
      var bottom = base - h * tiers[i][1];
      var hw = w * tiers[i][2] / 2 + w * 0.12;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(x, apex);
      g.lineTo(x + hw, bottom);
      g.lineTo(x - hw, bottom);
      g.closePath();
      g.fill();
      if (snow) {
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.beginPath();
        g.moveTo(x, apex);
        g.lineTo(x + hw * 0.45, apex + (bottom - apex) * 0.4);
        g.lineTo(x, apex + (bottom - apex) * 0.3);
        g.lineTo(x - hw * 0.45, apex + (bottom - apex) * 0.4);
        g.closePath();
        g.fill();
      }
    }
  }

  function snowyMountains(g, f, bottom, fill, snowLine) {
    g.fillStyle = fill;
    fillProfile(g, f, bottom);
    g.fillStyle = 'rgba(247,250,255,0.95)';
    g.beginPath();
    g.moveTo(0, f(0));
    var x;
    for (x = 0; x <= TILE; x += 4) g.lineTo(x, f(x));
    for (x = TILE; x >= 0; x -= 4) {
      var y = f(x);
      var depth = Math.max(0, snowLine - y) * 0.55;
      g.lineTo(x, y + depth * (0.75 + 0.25 * Math.sin(x * 0.35)));
    }
    g.closePath();
    g.fill();
  }

  function crack(g, rand, x, y, segments, color, width) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x, y);
    for (var i = 0; i < segments; i++) {
      x += 10 + rand() * 16;
      y += (rand() - 0.5) * 12;
      g.lineTo(x, y);
    }
    g.stroke();
  }

  /* ---------- приёмы «альфа»-стиля для фонов ---------- */

  /* Объём холма: сверху светлая кромка, ниже тело темнее — как у облаков, без белой обводки. */
  function shadeProfile(g, f, bottom, dark, lip) {
    g.fillStyle = dark;
    g.beginPath();
    g.moveTo(0, bottom);
    for (var x = 0; x <= TILE; x += 4) g.lineTo(x, f(x) + lip);
    g.lineTo(TILE, bottom);
    g.closePath();
    g.fill();
  }

  function skyRays(g, cx, cy, w, n, alpha) {
    var r = Math.max(w, H) * 1.6;
    g.fillStyle = 'rgba(255,255,255,' + alpha + ')';
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2;
      var d = Math.PI / n * 0.45;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a - d) * r, cy + Math.sin(a - d) * r);
      g.lineTo(cx + Math.cos(a + d) * r, cy + Math.sin(a + d) * r);
      g.closePath();
      g.fill();
    }
  }

  /* Искорки на небе: крупные — голографические, мелкие — белые. */
  function skySparkles(g, rand, w, count, maxY, holoShare) {
    for (var i = 0; i < count; i++) {
      var x = rand() * w;
      var y = 20 + rand() * maxY;
      var r = 3 + rand() * 5;
      if (rand() < holoShare) {
        sparkle(g, x, y, r + 1.5, holo(g, x - r, y - r, x + r, y + r));
      } else {
        sparkle(g, x, y, r, 'rgba(255,255,255,0.9)');
      }
    }
  }

  function glossySun(g, x, y, r) {
    sun(g, x, y, r, 'rgba(255,250,210,0.7)', '#FFFBD6', '#FFD24A');
    g.fillStyle = 'rgba(240,150,0,0.25)';
    g.beginPath();
    g.arc(x, y, r, 0.1 * Math.PI, 0.9 * Math.PI);
    g.arc(x, y + r * 0.25, r * 0.85, 0.85 * Math.PI, 0.15 * Math.PI, true);
    g.closePath();
    g.fill();
    gloss(g, x - r * 0.35, y - r * 0.4, r * 0.3, r * 0.16, -0.6, 0.8);
  }

  /* Надутое дерево: крона из нескольких долей, тёмная копия ниже даёт объём, блик сверху. */
  function blobTree(g, x, base, s, c0, c1) {
    var parts = [[0, -27, 12.5], [-10, -20, 10], [10, -20, 10.5], [0, -15, 11], [-4, -31, 8]];
    g.fillStyle = '#7A4220';
    roundRect(g, x - 2.2 * s, base - 15 * s, 4.4 * s, 15 * s, 2 * s);
    g.fill();
    g.fillStyle = '#A0622E';
    roundRect(g, x - 2.2 * s, base - 15 * s, 2.6 * s, 15 * s, 1.4 * s);
    g.fill();
    g.fillStyle = 'rgba(10,90,40,0.55)';
    parts.forEach(function (p) { circle(g, x + p[0] * s + 1.5 * s, base + p[1] * s + 3 * s, p[2] * s); });
    var gr = g.createLinearGradient(0, base - 40 * s, 0, base - 6 * s);
    gr.addColorStop(0, c0);
    gr.addColorStop(1, c1);
    g.fillStyle = gr;
    parts.forEach(function (p) { circle(g, x + p[0] * s, base + p[1] * s, p[2] * s); });
    gloss(g, x - 6 * s, base - 32 * s, 4.6 * s, 2.2 * s, -0.5, 0.6);
    gloss(g, x + 9 * s, base - 23 * s, 2.4 * s, 1.2 * s, -0.5, 0.45);
  }

  /* Цветок-наклейка для луга. */
  function flower(g, x, y, r, petal) {
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * Math.PI * 2;
      g.fillStyle = petal;
      circle(g, x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.85);
    }
    g.fillStyle = '#FFC21A';
    circle(g, x, y, r * 0.7);
  }

  /* Цветок на повторяющейся полосе: у края плитки дорисовывается и с другой стороны. */
  function drawFlower(g, x, y, r, petal) {
    wrapped(x, r * 2, function (cx) { flower(g, cx, y, r, petal); });
  }

  /* Надутая ёлка из трёх ярусов: тень со сдвигом, градиент, блик, снег по желанию. */
  function puffFir(g, x, base, h, c0, c1, snow) {
    var tiers = [[0, 0.58, 0.2], [0.24, 0.82, 0.28], [0.46, 1.04, 0.36]];
    function tier(t, pad) {
      var apex = base - h + t[0] * h - pad;
      var bottom = base - h + t[1] * h + pad * 0.6;
      var hw = h * t[2] + pad;
      g.beginPath();
      g.moveTo(x, apex);
      g.quadraticCurveTo(x + hw * 0.35, apex + (bottom - apex) * 0.45, x + hw, bottom - 2);
      g.quadraticCurveTo(x + hw, bottom + 1, x + hw - 3, bottom + 1);
      g.lineTo(x - hw + 3, bottom + 1);
      g.quadraticCurveTo(x - hw, bottom + 1, x - hw, bottom - 2);
      g.quadraticCurveTo(x - hw * 0.35, apex + (bottom - apex) * 0.45, x, apex);
      g.closePath();
    }
    g.save();
    g.translate(1.6, 2.4);
    g.fillStyle = 'rgba(5,60,40,0.5)';
    tiers.forEach(function (t) { tier(t, 0); g.fill(); });
    g.restore();
    var gr = g.createLinearGradient(0, base - h, 0, base);
    gr.addColorStop(0, c0);
    gr.addColorStop(1, c1);
    tiers.forEach(function (t) {
      tier(t, 0);
      g.fillStyle = gr;
      g.fill();
      if (snow) {
        var apex = base - h + t[0] * h;
        var hw = h * t[2];
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(x, apex);
        g.quadraticCurveTo(x + hw * 0.3, apex + h * 0.12, x + hw * 0.45, apex + h * 0.2);
        g.quadraticCurveTo(x, apex + h * 0.13, x - hw * 0.45, apex + h * 0.2);
        g.quadraticCurveTo(x - hw * 0.3, apex + h * 0.12, x, apex);
        g.fill();
      }
    });
    gloss(g, x - h * 0.1, base - h * 0.62, h * 0.035, h * 0.1, 0.4, 0.6);
    gloss(g, x - h * 0.15, base - h * 0.3, h * 0.04, h * 0.11, 0.4, 0.5);
  }

  function aurora(g, w, colors) {
    g.lineCap = 'round';
    var widths = [30, 16, 6];
    var alphas = [0.08, 0.13, 0.28];
    for (var k = 0; k < colors.length; k++) {
      for (var j = 0; j < widths.length; j++) {
        g.strokeStyle = 'rgba(' + colors[k] + ',' + alphas[j] + ')';
        g.lineWidth = widths[j];
        g.beginPath();
        for (var x = -20; x <= w + 20; x += 8) {
          var y = 70 + k * 34 + Math.sin(x * 0.012 + k * 1.7) * 18 + Math.sin(x * 0.031 + k) * 6;
          if (x === -20) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
  }

  /* ---------- сцены регионов ---------- */

  var SCENES = {
    /* Чувашия: летнее небо от голубого к солнечному, мятные дали, глянцевая Волга, лаймовые холмы, луг */
    volga: {
      sky: function (g, w, rand) {
        g.fillStyle = vGradient(g, 0, H, [[0, '#36C2FF'], [0.6, '#A6EBFF'], [1, '#FFF3A6']]);
        g.fillRect(0, 0, w, H);
        skyRays(g, w * 0.72, 120, w, 14, 0.12);
        glossySun(g, w * 0.72, 120, 30);
        skySparkles(g, rand, w, 10, 270, 0.35);
      },
      layers: [
        {
          top: 40, h: 240, factor: 0.05,
          draw: function (g, rand) { clouds(g, rand, 6, 90, 230, '#ffffff', 'rgba(90,150,255,0.28)'); }
        },
        {
          top: 360, h: 142, factor: 0.12,
          draw: function (g, rand) {
            var f = profile(rand, 7, 396, 432, true);
            g.fillStyle = '#E4FFF0';
            fillProfile(g, f, 470);
            shadeProfile(g, f, 470, vGradient(g, 396, 470, [[0, '#B4F2D2'], [1, '#6FD3A8']]), 5);
            // далёкий город над Волгой
            var x0 = TILE * 0.3;
            g.fillStyle = 'rgba(255,255,255,0.9)';
            for (var i = 0; i < 9; i++) {
              var bx = x0 + 14 + i * 9;
              var bh = 5 + ((i * 7) % 5) * 2.4;
              g.fillRect(bx, f(bx) + 3 - bh, 7, bh);
            }
            // глянцевая Волга
            g.fillStyle = vGradient(g, 452, 502, [[0, '#7DF3FF'], [1, '#2E8BFF']]);
            g.fillRect(0, 452, TILE, 50);
            g.fillStyle = 'rgba(20,90,200,0.25)';
            g.fillRect(0, 452, TILE, 5);
            g.fillStyle = 'rgba(255,255,255,0.7)';
            for (var k = 0; k < 26; k++) {
              var len = 10 + rand() * 26;
              roundRect(g, rand() * (TILE - len), 458 + rand() * 38, len, 2.4, 1.2);
              g.fill();
            }
          }
        },
        {
          top: 430, h: 150, factor: 0.28,
          draw: function (g, rand) {
            var f = profile(rand, 5, 482, 508, true);
            g.fillStyle = '#F4FF9A';
            fillProfile(g, f, 580);
            shadeProfile(g, f, 580, vGradient(g, 476, 580, [[0, '#C8F55A'], [1, '#34C04A']]), 6);
            var i;
            // поля, домики и рощи не наползают друг на друга: каждому ищется свободное место
            var fields = [];
            g.fillStyle = 'rgba(255,228,92,0.85)';
            for (i = 0; i < 4; i++) {
              var fx = freeSpot(rand, fields, 42, 12);
              if (fx === null) continue;
              fields.push({ x: fx, half: 42 });
              wrapped(fx, 46, function (x) {
                g.beginPath();
                g.moveTo(x - 37, f(x - 37) + 8);
                g.lineTo(x + 37, f(x + 37) + 8);
                g.lineTo(x + 29, f(x + 29) + 29);
                g.lineTo(x - 45, f(x - 45) + 29);
                g.closePath();
                g.fill();
              });
            }
            var taken = [];
            for (i = 0; i < 3; i++) {
              var hx = freeSpot(rand, taken, 10, 30);
              if (hx === null) continue;
              taken.push({ x: hx, half: 10 });
              wrapped(hx, 14, function (x) {
                var y = f(x) + 5;
                g.fillStyle = '#FFD3A8';
                g.fillRect(x - 8, y - 12, 16, 12);
                g.fillStyle = 'rgba(160,70,20,0.25)';
                g.fillRect(x + 1, y - 12, 7, 12);
                g.fillRect(x - 8, y - 12, 16, 2.5);
                g.fillStyle = '#FF7A3D';
                g.beginPath();
                g.moveTo(x - 10, y - 12);
                g.lineTo(x, y - 21.5);
                g.lineTo(x + 10, y - 12);
                g.closePath();
                g.fill();
                g.fillStyle = '#7DF3FF';
                g.fillRect(x - 3, y - 9, 6, 5);
              });
            }
            // рощи по 2–3 дерева: не заслоняют домики и не сливаются друг с другом
            for (i = 0; i < 4; i++) {
              var n = 2 + Math.floor(rand() * 2);
              var half = 10 * (n - 1) + 27;
              var mid = freeSpot(rand, taken, half, 6);
              if (mid === null) continue;
              taken.push({ x: mid, half: half });
              var cx = mid - 10 * (n - 1) - 3;
              for (var k = 0; k < n; k++) {
                var tx = cx + k * 20 + rand() * 6;
                var ts = 0.75 + rand() * 0.35;
                wrapped(tx, 28, function (x) { blobTree(g, x, f(x) + 4, ts, '#C8FF5A', '#1FAE4B'); });
              }
            }
          }
        },
        {
          top: 470, h: 110, factor: 0.5,
          draw: function (g, rand) {
            var f = profile(rand, 6, 540, 556, true);
            g.fillStyle = '#9DF5A8';
            fillProfile(g, f, 580);
            shadeProfile(g, f, 580, vGradient(g, 536, 580, [[0, '#55DC74'], [1, '#1E9E48']]), 5);
            for (var i = 0; i < 3; i++) {
              var ts = 1.25 + rand() * 0.35;
              wrapped(rand() * TILE, 34, function (x) { blobTree(g, x, f(x) + 6, ts, '#B6FF5A', '#159E4A'); });
            }
          }
        }
      ],
      ground: function (g, rand) {
        g.fillStyle = vGradient(g, GROUND, H, [[0, '#8BE84F'], [1, '#3DB54A']]);
        g.fillRect(0, GROUND, TILE, H - GROUND);
        g.fillStyle = '#C2FF7A';
        g.fillRect(0, GROUND, TILE, 4);
        g.fillStyle = 'rgba(20,110,40,0.25)';
        g.fillRect(0, GROUND + 4, TILE, 3);
        // цветы ровным ковром: по одному в каждой клетке сетки со случайным сдвигом внутри неё,
        // второй ряд смещён на полклетки — без пустых проплешин и без рядов «по линейке»
        var petals = ['#ffffff', '#ffffff', '#FFB3EC', '#B9A2FF'];
        var cols = 24;
        var rows = 2;
        var cw = TILE / cols;
        var ch = 44 / rows;
        for (var row = 0; row < rows; row++) {
          for (var col = 0; col < cols; col++) {
            var x = (col + 0.15 + rand() * 0.7 + (row % 2) * 0.5) * cw;
            var y = 586 + (row + 0.15 + rand() * 0.7) * ch;
            var r = 1.8 + rand() * 1.2;
            var petal = petals[Math.floor(rand() * petals.length)];
            drawFlower(g, x % TILE, y, r, petal);
          }
        }
      }
    },

    /* Коми: фиолетово-розовое небо, лаймовое сияние, лавандовые горы, надутые ёлки */
    ural: {
      sky: function (g, w, rand) {
        g.fillStyle = vGradient(g, 0, H, [[0, '#2B1A8C'], [0.5, '#7B4DFF'], [1, '#FF8FD8']]);
        g.fillRect(0, 0, w, H);
        skySparkles(g, rand, w, 22, 260, 0.3);
        aurora(g, w, ['198,255,58', '80,240,255', '198,255,58']);
      },
      layers: [
        {
          top: 150, h: 140, factor: 0.04,
          draw: function (g, rand) {
            g.fillStyle = 'rgba(255,170,230,0.32)';
            for (var i = 0; i < 6; i++) {
              var rx = 40 + rand() * 50;
              var y = 175 + rand() * 95;
              var ry = 4 + rand() * 4;
              wrapped(rand() * TILE, rx, function (x) { ellipse(g, x, y, rx, ry); });
            }
          }
        },
        {
          top: 250, h: 272, factor: 0.1,
          draw: function (g, rand) {
            var f = profile(rand, 16, 302, 440, false);
            snowyMountains(g, f, 520, vGradient(g, 300, 520, [[0, '#F1EBFF'], [1, '#8F6BFF']]), 385);
          }
        },
        {
          top: 400, h: 170, factor: 0.2,
          draw: function (g, rand) {
            var f = profile(rand, 5, 472, 484, true);
            g.fillStyle = '#FBE2FF';
            fillProfile(g, f, 570);
            shadeProfile(g, f, 570, vGradient(g, 468, 570, [[0, '#E9B4FF'], [1, '#A86BE0']]), 5);
          }
        },
        {
          top: 420, h: 160, factor: 0.42,
          draw: function (g, rand) {
            g.fillStyle = vGradient(g, 556, 580, [[0, '#2FB36A'], [1, '#136B4A']]);
            g.fillRect(0, 556, TILE, 24);
            var trees = [];
            for (var i = 0; i < 20; i++) {
              trees.push({ x: rand() * TILE, h: 44 + rand() * 44, base: 566 + rand() * 10 });
            }
            trees.sort(function (a, b) { return a.base - b.base; });
            trees.forEach(function (t) {
              wrapped(t.x, t.h * 0.4, function (x) { puffFir(g, x, t.base, t.h, '#9BFF6B', '#109A48', false); });
            });
          }
        }
      ],
      ground: function (g, rand) {
        g.fillStyle = vGradient(g, GROUND, H, [[0, '#6A4BD0'], [1, '#3B2690']]);
        g.fillRect(0, GROUND, TILE, H - GROUND);
        g.fillStyle = vGradient(g, GROUND, GROUND + 9, [[0, '#C6FF3A'], [1, '#6CD13B']]);
        g.fillRect(0, GROUND, TILE, 9);
        g.fillStyle = 'rgba(20,10,70,0.3)';
        g.fillRect(0, GROUND + 9, TILE, 3);
        var i;
        g.fillStyle = 'rgba(198,255,58,0.85)';
        for (i = 0; i < 40; i++) {
          circle(g, rand() * (TILE - 4) + 2, 584 + rand() * 52, 1 + rand() * 1.2);
        }
        // камешки не наползают друг на друга: место подбирается, пока не найдётся свободное
        var stones = [];
        for (i = 0; i < 16; i++) {
          var rx = 5 + rand() * 7;
          var ry = 3 + rand() * 3;
          for (var tries = 0; tries < 30; tries++) {
            var sx = rand() * TILE;
            var sy = 592 + rand() * 38;
            if (stoneFits(stones, sx, sy, rx, ry)) {
              stones.push({ x: sx, y: sy, rx: rx, ry: ry });
              break;
            }
          }
        }
        stones.forEach(function (s) {
          wrapped(s.x, s.rx + 2, function (x) {
            g.fillStyle = 'rgba(30,10,80,0.45)';
            ellipse(g, x + 1, s.y + 1.6, s.rx, s.ry);
            g.fillStyle = '#CDB8FF';
            ellipse(g, x, s.y, s.rx, s.ry);
            gloss(g, x - s.rx * 0.3, s.y - s.ry * 0.35, s.rx * 0.4, s.ry * 0.3, 0, 0.7);
          });
        });
      }
    },

    /* Бурятия: ярко-голубое небо, глянцевый лёд Байкала, надутые сосны в снегу */
    baikal: {
      sky: function (g, w, rand) {
        g.fillStyle = vGradient(g, 0, H, [[0, '#2E6BFF'], [0.55, '#3FB8FF'], [1, '#9AF4FF']]);
        g.fillRect(0, 0, w, H);
        skyRays(g, w * 0.22, 96, w, 12, 0.1);
        glossySun(g, w * 0.22, 96, 24);
        skySparkles(g, rand, w, 14, 280, 0.2);
      },
      layers: [
        {
          top: 40, h: 220, factor: 0.05,
          draw: function (g, rand) { clouds(g, rand, 4, 90, 220, '#ffffff', 'rgba(90,140,255,0.3)'); }
        },
        {
          top: 320, h: 160, factor: 0.1,
          draw: function (g, rand) {
            var f = profile(rand, 13, 352, 428, false);
            snowyMountains(g, f, 470, vGradient(g, 350, 470, [[0, '#E8F2FF'], [1, '#7FA8F5']]), 405);
          }
        },
        {
          top: 440, h: 120, factor: 0.24,
          draw: function (g, rand) {
            g.fillStyle = vGradient(g, 455, 556, [[0, '#C9FAFF'], [1, '#4FD3F0']]);
            g.fillRect(0, 455, TILE, 101);
            g.fillStyle = 'rgba(30,120,200,0.22)';
            g.fillRect(0, 455, TILE, 5);
            var i;
            for (i = 0; i < 12; i++) {
              var cy = 464 + rand() * 76;
              var seed = Math.floor(rand() * 100000);
              wrapped(rand() * TILE, 120, function (x) { crack(g, rng(seed), x, cy, 5, 'rgba(255,255,255,0.75)', 1.4); });
            }
            for (i = 0; i < 7; i++) {
              var hy = 474 + rand() * 56;
              var hs = 0.8 + rand() * 0.5;
              wrapped(rand() * TILE, 22, function (x) {
                for (var k = 0; k < 3; k++) {
                  var px = x + (k - 1) * 8 * hs;
                  var ph = (10 + (k === 1 ? 7 : 0)) * hs;
                  g.fillStyle = '#9FF1FF';
                  g.beginPath();
                  g.moveTo(px - 6 * hs, hy);
                  g.lineTo(px, hy - ph);
                  g.lineTo(px + 6 * hs, hy);
                  g.closePath();
                  g.fill();
                  g.fillStyle = 'rgba(40,150,220,0.45)';
                  g.beginPath();
                  g.moveTo(px, hy - ph);
                  g.lineTo(px + 6 * hs, hy);
                  g.lineTo(px + hs, hy);
                  g.closePath();
                  g.fill();
                }
              });
            }
          }
        },
        {
          top: 490, h: 90, factor: 0.48,
          draw: function (g, rand) {
            var f = profile(rand, 8, 536, 552, true);
            g.fillStyle = '#FFFFFF';
            fillProfile(g, f, 580);
            shadeProfile(g, f, 580, vGradient(g, 530, 580, [[0, '#E6F0FF'], [1, '#C4D8F5']]), 5);
            for (var i = 0; i < 10; i++) {
              var h = 42 + rand() * 40;
              wrapped(rand() * TILE, h * 0.4, function (x) { puffFir(g, x, f(x) + 6, h, '#3FD4A0', '#0B7A5A', true); });
            }
          }
        }
      ],
      ground: function (g, rand) {
        g.fillStyle = vGradient(g, GROUND, H, [[0, '#D6FCFF'], [1, '#5FD6F2']]);
        g.fillRect(0, GROUND, TILE, H - GROUND);
        g.fillStyle = '#EAFDFF';
        g.fillRect(0, GROUND, TILE, 4);
        g.fillStyle = 'rgba(30,120,200,0.2)';
        g.fillRect(0, GROUND + 4, TILE, 3);
        var i;
        for (i = 0; i < 20; i++) {
          var by = 596 + rand() * 32;
          var n = 3 + Math.floor(rand() * 4);
          wrapped(rand() * TILE, 6, function (x) {
            for (var k = 0; k < n; k++) {
              var r = 3.4 - k * 0.45;
              if (r <= 0.8) break;
              g.fillStyle = 'rgba(255,255,255,0.45)';
              circle(g, x + (k % 2) * 1.5, by - k * 6, r);
              g.strokeStyle = '#ffffff';
              g.lineWidth = 0.9;
              g.stroke();
            }
          });
        }
        for (i = 0; i < 6; i++) {
          var cy = 584 + rand() * 46;
          var seed = Math.floor(rand() * 100000);
          wrapped(rand() * TILE, 120, function (x) { crack(g, rng(seed), x, cy, 5, 'rgba(255,255,255,0.75)', 1.2); });
        }
      }
    }
  };

  /* ---------- кэш слоёв ---------- */

  function buildLayer(top, h, factor, draw, seed) {
    var c = makeCanvas(TILE * scale, h * scale);
    var g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, -top * scale);
    draw(g, rng(seed));
    return { canvas: c, top: top, h: h, factor: factor };
  }

  function getScene(name) {
    var key = sceneKey(name);
    if (sceneCache[key]) return sceneCache[key];
    var def = SCENES[name] || SCENES.volga;
    var skyScale = scale * 0.5;
    var sky = makeCanvas(viewW * skyScale, H * skyScale);
    var sg = sky.getContext('2d');
    sg.setTransform(skyScale, 0, 0, skyScale, 0, 0);
    def.sky(sg, viewW, rng(7));
    var layers = def.layers.map(function (l, i) { return buildLayer(l.top, l.h, l.factor, l.draw, 101 + i * 37); });
    var ground = buildLayer(GROUND, H - GROUND, 1, def.ground, 977);
    sceneCache[key] = { sky: sky, layers: layers, ground: ground };
    return sceneCache[key];
  }

  function drawTiled(ctx, layer, scrollX) {
    var offset = (scrollX * layer.factor) % TILE;
    var x = Math.round(-offset * scale) / scale;
    while (x < viewW) {
      ctx.drawImage(layer.canvas, x, layer.top, TILE, layer.h);
      x += TILE;
    }
  }

  function drawBack(ctx, name, scrollX, alpha) {
    var scene = getScene(name);
    ctx.globalAlpha = alpha;
    ctx.drawImage(scene.sky, 0, 0, viewW, H);
    for (var i = 0; i < scene.layers.length; i++) drawTiled(ctx, scene.layers[i], scrollX);
    ctx.globalAlpha = 1;
  }

  function drawGround(ctx, name, scrollX, alpha) {
    ctx.globalAlpha = alpha;
    drawTiled(ctx, getScene(name).ground, scrollX);
    ctx.globalAlpha = 1;
  }

  /* Оставляет только сцены keep в текущем масштабе, остальное отдаёт сборщику мусора. */
  function release(keep) {
    var keepKeys = keep.map(sceneKey);
    Object.keys(sceneCache).forEach(function (key) {
      if (keepKeys.indexOf(key) === -1) delete sceneCache[key];
    });
    Object.keys(obstacleCache).forEach(function (key) {
      if (key.split('|')[1] !== String(scale)) delete obstacleCache[key];
    });
  }

  /* ---------- препятствия ---------- */

  var OBSTACLES = {
    /* Чувашия: глянцевый деревянный столб с золотой шапкой */
    pillar: function (g) {
      var w = OB_W + CAP * 2;
      var body = g.createLinearGradient(CAP, 0, CAP + OB_W, 0);
      body.addColorStop(0, '#E8A55E');
      body.addColorStop(0.35, '#FFE2B0');
      body.addColorStop(0.7, '#FBCB8A');
      body.addColorStop(1, '#D98D47');
      g.fillStyle = body;
      g.fillRect(CAP, 0, OB_W, H);
      g.strokeStyle = 'rgba(150,80,20,0.16)';
      g.lineWidth = 1;
      for (var i = 0; i < 7; i++) {
        var gx = CAP + 6 + i * 8.5;
        g.beginPath();
        g.moveTo(gx, 0);
        for (var y = 0; y <= H; y += 20) g.lineTo(gx + Math.sin(y * 0.05 + i) * 1.5, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,0.5)';
      roundRect(g, CAP + 9, 30, 6, H - 40, 3);
      g.fill();
      g.fillStyle = 'rgba(120,60,10,0.3)';
      roundRect(g, 0, 4, w, 20, 7);
      g.fill();
      var cap = g.createLinearGradient(0, 0, 0, 20);
      cap.addColorStop(0, '#FFE680');
      cap.addColorStop(1, '#FFA41C');
      g.fillStyle = cap;
      roundRect(g, 0, 0, w, 20, 7);
      g.fill();
      gloss(g, w * 0.32, 7, w * 0.22, 2.2, 0, 0.7);
    },
    /* Коми: лиловый камень как на открытке Маньпупунёра, с лишайником */
    rock: function (g) {
      var r = rng(31);
      var w = OB_W + CAP * 2;
      var left = [];
      var right = [];
      for (var y = 0; y <= H + 16; y += 16) {
        left.push([CAP + 2 + r() * 6, y]);
        right.push([CAP + OB_W - 2 - r() * 6, y]);
      }
      function outline() {
        g.beginPath();
        g.moveTo(left[0][0], left[0][1]);
        left.forEach(function (p) { g.lineTo(p[0], p[1]); });
        right.slice().reverse().forEach(function (p) { g.lineTo(p[0], p[1]); });
        g.closePath();
      }
      outline();
      var body = g.createLinearGradient(CAP, 0, CAP + OB_W, 0);
      body.addColorStop(0, '#F1E8FF');
      body.addColorStop(0.45, '#BBA6E2');
      body.addColorStop(1, '#7A64A8');
      g.fillStyle = body;
      g.fill();
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(90,60,140,0.22)';
      g.lineWidth = 1.5;
      for (var sy = 30; sy < H; sy += 14 + r() * 12) {
        g.beginPath();
        g.moveTo(0, sy);
        for (var sx = 0; sx <= w; sx += 8) g.lineTo(sx, sy + Math.sin(sx * 0.2 + sy) * 1.8);
        g.stroke();
      }
      g.fillStyle = 'rgba(198,255,58,0.6)';
      for (var i = 0; i < 30; i++) circle(g, CAP + 4 + r() * (OB_W - 8), 30 + r() * (H - 40), 1.4 + r() * 2.2);
      g.fillStyle = 'rgba(255,255,255,0.45)';
      roundRect(g, CAP + 12, 34, 6, H - 50, 3);
      g.fill();
      g.restore();
      g.fillStyle = 'rgba(50,20,100,0.35)';
      roundRect(g, 0, 4, w, 24, 12);
      g.fill();
      var cap = g.createLinearGradient(0, 0, 0, 24);
      cap.addColorStop(0, '#F6EEFF');
      cap.addColorStop(1, '#A08BD0');
      g.fillStyle = cap;
      roundRect(g, 0, 0, w, 24, 12);
      g.fill();
      gloss(g, w * 0.36, 8, w * 0.24, 2.6, 0, 0.75);
    },
    /* Бурятия: глянцевая ледяная глыба со снежной шапкой */
    ice: function (g) {
      var r = rng(53);
      var w = OB_W + CAP * 2;
      var body = g.createLinearGradient(CAP, 0, CAP + OB_W, 0);
      body.addColorStop(0, 'rgba(225,253,255,0.98)');
      body.addColorStop(0.5, 'rgba(120,226,248,0.98)');
      body.addColorStop(1, 'rgba(60,170,240,0.98)');
      g.fillStyle = body;
      g.fillRect(CAP, 0, OB_W, H);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(CAP + 10, 0, 7, H);
      g.fillStyle = 'rgba(255,255,255,0.28)';
      g.fillRect(CAP + 22, 0, 3, H);
      g.fillStyle = 'rgba(30,110,200,0.22)';
      g.fillRect(CAP + OB_W - 12, 0, 2, H);
      for (var i = 0; i < 9; i++) crack(g, r, CAP + 4, 40 + r() * (H - 60), 3, 'rgba(255,255,255,0.5)', 1);
      for (var k = 0; k < 20; k++) {
        g.fillStyle = 'rgba(255,255,255,0.6)';
        circle(g, CAP + 8 + r() * (OB_W - 16), 40 + r() * (H - 60), 1 + r() * 1.6);
      }
      g.fillStyle = 'rgba(40,120,220,0.35)';
      roundRect(g, 0, 4, w, 19, 9);
      g.fill();
      for (var sx = 6; sx < w; sx += 12) circle(g, sx, 22, 5);
      g.fillStyle = '#F4FCFF';
      roundRect(g, 0, 0, w, 19, 9);
      g.fill();
      for (var bx = 6; bx < w; bx += 12) circle(g, bx, 18, 5);
      gloss(g, w * 0.3, 6, w * 0.2, 2, 0, 0.8);
    }
  };

  function getObstacle(style) {
    var key = obstacleKey(style);
    if (obstacleCache[key]) return obstacleCache[key];
    var c = makeCanvas((OB_W + CAP * 2) * scale, H * scale);
    var g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    (OBSTACLES[style] || OBSTACLES.pillar)(g);
    obstacleCache[key] = c;
    return c;
  }

  /* Нижняя часть — шапкой вверх от края просвета, верхняя — та же картинка, отражённая. */
  function drawObstacle(ctx, style, x, gapTop, gapBottom) {
    var sprite = getObstacle(style);
    var w = OB_W + CAP * 2;
    var sx = x - CAP;
    var bottomH = GROUND - gapBottom;
    if (bottomH > 0) ctx.drawImage(sprite, 0, 0, sprite.width, bottomH * scale, sx, gapBottom, w, bottomH);
    if (gapTop > 0) {
      ctx.save();
      ctx.translate(0, gapTop);
      ctx.scale(1, -1);
      ctx.drawImage(sprite, 0, 0, sprite.width, gapTop * scale, sx, 0, w, gapTop);
      ctx.restore();
    }
  }

  /* ---------- котик-супергерой ---------- */
  /* Котик нарисован в векторе и лежит в img/hero.svg восемью слоями в ряд: туловище с головой
     и воротником плаща, сам плащ, хвост, закрытые глаза, дальняя задняя лапа и верхняя передняя
     (обе за туловищем), нижняя передняя и ближняя задняя (обе перед ним). Туловище неподвижно,
     плащ и хвост колышутся волной, лапы поворачиваются от рывков, закрытые глаза время от времени
     кладутся поверх — котик моргает. */

  function gloss(g, x, y, rx, ry, rot, alpha) {
    g.save();
    g.translate(x, y);
    g.rotate(rot || 0);
    g.fillStyle = 'rgba(255,255,255,' + (alpha || 0.7) + ')';
    ellipse(g, 0, 0, rx, ry);
    g.restore();
  }

  function holo(g, x0, y0, x1, y1) {
    var gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, '#E8FDFF');
    gr.addColorStop(0.3, '#8EF1FF');
    gr.addColorStop(0.55, '#FFB3EC');
    gr.addColorStop(0.8, '#B9A2FF');
    gr.addColorStop(1, '#F3EEFF');
    return gr;
  }

  /* Четырёхлучевая искорка, как в глазах персонажей на референсах. */
  function sparkle(g, x, y, r, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x + r * 0.15, y - r * 0.15, x + r, y);
    g.quadraticCurveTo(x + r * 0.15, y + r * 0.15, x, y + r);
    g.quadraticCurveTo(x - r * 0.15, y + r * 0.15, x - r, y);
    g.quadraticCurveTo(x - r * 0.15, y - r * 0.15, x, y - r);
    g.closePath();
    g.fill();
  }

  var HERO_SRC = 'img/hero.svg';
  var HERO_W = 440;                        // размер слоя в пикселях
  var HERO_H = 280;
  var HERO_PX = HERO_W / 90;               // пикселей слоя в единице мира: котик шириной 90
  var HERO_ANCHOR = { x: 240, y: 190 };    // центр туловища в слое — точка (x, y) котика
  var HERO_PAD = 24;                       // поле вокруг слоя под мягкую тень
  var HERO_ROOM = 40;                      // запас сверху, куда плащ взлетает, когда котик падает
  var BODY = 0, CAPE = 1, TAIL = 2, BLINK = 3, HIND = 4, FRONT = 5, FRONT_LOW = 6, HIND_LOW = 7;
  var HERO_LAYERS = 8;
  /* Плащ и хвост колышутся бегущей волной: у основания (base) стоят на месте, к кончику (tip)
     размах растёт до amp пикселей, flutter — мелкая рябь поверх. bend — на сколько пикселей
     кончик уходит вниз, когда котик рвётся вверх (и вверх, когда падает).
     from..to — какие столбцы слоя рисовать, с запасом под тень. Плащ крепится у шеи, хвост — у спины. */
  var WAVES = [
    { layer: CAPE, from: 4, to: 318, tip: 18, base: 296, amp: 15, hz: 1.7, length: 260, flutter: 0.35, bend: 58, phase: 0 },
    { layer: TAIL, from: 40, to: 192, tip: 56, base: 172, amp: 9, hz: 1.1, length: 200, flutter: 0, bend: 16, phase: 1.7 }
  ];
  /* Лапы поворачиваются вокруг бедра и плеча (x, y): при рывке вверх отстают и опускаются,
     при падении приподнимаются. gain — угол в радианах на единицу отклонения. Кроме того, лапы
     всё время плавно «гребут»: sway — размах покачивания в радианах, phase — сдвиг, чтобы передние
     и задние шли в противофазе. Дальняя задняя и верхняя передняя растут из-под туловища;
     нижняя передняя и ближняя задняя лежат поверх него (over). */
  var LEGS = [
    { layer: HIND, x: 205, y: 205, gain: -0.26, sway: 0.09, phase: 0 },
    { layer: FRONT, x: 300, y: 194, gain: 0.22, sway: 0.06, phase: Math.PI },
    { layer: FRONT_LOW, x: 296, y: 204, gain: 0.24, sway: 0.08, phase: Math.PI + 0.7, over: true },
    { layer: HIND_LOW, x: 212, y: 208, gain: -0.26, sway: 0.08, phase: 0.8, over: true }
  ];
  var LEG_SWAY_HZ = 1.4;
  var REST = { cape: 0, legs: 0 };
  var STRIP = 2;                           // ширина полоски, которой режется волна
  var heroImg = null;
  var heroLayers = null;                   // слои с тенью
  var heroCanvas = null;                   // сюда каждый кадр собирается котик

  function loadHero(done) {
    var img = new Image();
    img.onload = function () {
      heroImg = img;
      heroLayers = null;
      done();
    };
    img.onerror = function () { done(); };
    img.src = HERO_SRC;
  }

  /* Тень считается один раз: каждый слой вместе с тенью лежит в своём холсте. */
  function buildHeroLayers() {
    heroLayers = [];
    for (var i = 0; i < HERO_LAYERS; i++) {
      var c = makeCanvas(HERO_W + HERO_PAD * 2, HERO_H + HERO_PAD * 2);
      var g = c.getContext('2d');
      if (i !== BLINK) {
        g.shadowColor = 'rgba(42,10,90,0.28)';
        g.shadowBlur = 12;
        g.shadowOffsetY = 12;
      }
      g.drawImage(heroImg, i * HERO_W, 0, HERO_W, HERO_H, HERO_PAD, HERO_PAD, HERO_W, HERO_H);
      heroLayers.push(c);
    }
    heroCanvas = makeCanvas(HERO_W + HERO_PAD * 2, HERO_H + HERO_PAD * 2 + HERO_ROOM);
  }

  /* Слой режется на вертикальные полоски по целым пикселям, и каждая сдвигается по вертикали:
     волна бежит от основания к кончику без швов между полосками. Пока плащ отклонён рывком,
     он и трепещет сильнее. */
  function drawWave(g, w, t, bend) {
    var src = heroLayers[w.layer];
    var h = src.height;
    var omega = t * w.hz * Math.PI * 2 + w.phase;
    var amp = w.amp * (1 + 0.6 * Math.min(1, Math.abs(bend)));
    for (var x = w.from; x < w.to; x += STRIP) {
      var d = Math.max(0, Math.min(1, (w.base - x) / (w.base - w.tip)));
      var k = (w.base - x) / w.length * Math.PI * 2;
      var wave = Math.sin(omega - k) + w.flutter * Math.sin(omega * 2.3 - k * 2.1 + 1.1);
      var dy = amp * Math.pow(d, 1.6) * wave + w.bend * bend * Math.pow(d, 1.2);
      g.drawImage(src, x + HERO_PAD, 0, STRIP, h, x + HERO_PAD, dy + HERO_ROOM, STRIP, h);
    }
  }

  /* Плащ и хвост колышутся, лапы поворачиваются под туловищем, глаза иногда моргают. */
  function composeHero(t, pose) {
    var g = heroCanvas.getContext('2d');
    var i;
    g.clearRect(0, 0, heroCanvas.width, heroCanvas.height);
    for (i = 0; i < WAVES.length; i++) drawWave(g, WAVES[i], t, pose.cape);
    var legs = Math.max(-1, Math.min(1.3, pose.legs));
    drawLegs(g, t, legs, false);
    g.drawImage(heroLayers[BODY], 0, HERO_ROOM);
    drawLegs(g, t, legs, true);
    if (t % 2.6 > 2.45) g.drawImage(heroLayers[BLINK], 0, HERO_ROOM);
  }

  /* over — лапы, которые лежат поверх туловища; остальные рисуются под ним. */
  function drawLegs(g, t, legs, over) {
    var swing = t * LEG_SWAY_HZ * Math.PI * 2;
    for (var i = 0; i < LEGS.length; i++) {
      var l = LEGS[i];
      if (!l.over !== !over) continue;
      var px = l.x + HERO_PAD;
      var py = l.y + HERO_PAD + HERO_ROOM;
      g.save();
      g.translate(px, py);
      g.rotate(l.gain * legs + l.sway * Math.sin(swing + l.phase));
      g.translate(-px, -py);
      g.drawImage(heroLayers[l.layer], 0, HERO_ROOM);
      g.restore();
    }
  }

  /* Полоски ветра позади: котик мчится вперёд. */
  function drawWind(g, t) {
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.lineWidth = 2.2;
    [[-17, 0], [-3, 1.7], [11, 3.4]].forEach(function (l) {
      var k = (t * 2.2 + l[1] / 5) % 1;
      g.globalAlpha = 0.6 * Math.sin(k * Math.PI);
      g.beginPath();
      g.moveTo(-50 - k * 10, l[0]);
      g.lineTo(-62 - k * 14, l[0]);
      g.stroke();
    });
    g.globalAlpha = 1;
  }

  /* zoom — крупный план на заставке. pose.cape и pose.legs — насколько плащ и лапы отстают
     от движения: 1 — котик рванул вверх и они ушли вниз, отрицательное — падает и они задрались. */
  function drawHero(ctx, x, y, rot, t, zoom, pose) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    if (zoom && zoom !== 1) ctx.scale(zoom, zoom);
    drawWind(ctx, t);
    if (heroImg) {
      if (!heroLayers) buildHeroLayers();
      composeHero(t, pose || REST);
      var k = 1 / HERO_PX;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(heroCanvas, -(HERO_ANCHOR.x + HERO_PAD) * k, -(HERO_ANCHOR.y + HERO_PAD + HERO_ROOM) * k,
        heroCanvas.width * k, heroCanvas.height * k);
    }
    ctx.restore();
  }

  function drawCoin(ctx, x, y, t) {
    var sx = 0.3 + 0.7 * Math.abs(Math.cos(t * 3));
    ctx.save();
    ctx.translate(x, y);
    var glow = ctx.createRadialGradient(0, 0, 4, 0, 0, 20);
    glow.addColorStop(0, 'rgba(255,230,120,0.55)');
    glow.addColorStop(1, 'rgba(255,230,120,0)');
    ctx.fillStyle = glow;
    circle(ctx, 0, 0, 20);
    ctx.scale(sx, 1);
    ctx.fillStyle = 'rgba(150,70,0,0.35)';
    circle(ctx, 0.8, 1.8, 11);
    var face = ctx.createLinearGradient(-11, -11, 11, 11);
    face.addColorStop(0, '#FFF3A0');
    face.addColorStop(0.5, '#FFC93A');
    face.addColorStop(1, '#FF9A1A');
    ctx.fillStyle = face;
    circle(ctx, 0, 0, 11);
    ctx.strokeStyle = 'rgba(200,110,0,0.55)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 8.4, 0, Math.PI * 2);
    ctx.stroke();
    gloss(ctx, -4, -6, 3.6, 1.6, -0.5, 0.7);
    ctx.fillStyle = '#fff6c8';
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var r = i % 2 ? 2.6 : 6;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  window.Art = {
    H: H,
    GROUND: GROUND,
    OB_W: OB_W,
    setup: function (s, w) {
      scale = s;
      viewW = w;
    },
    prepare: function (name) { getScene(name); },
    drawBack: drawBack,
    drawGround: drawGround,
    release: release,
    drawObstacle: drawObstacle,
    drawHero: drawHero,
    drawCoin: drawCoin,
    load: loadHero
  };
})();
