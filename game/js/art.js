/* Вся графика игры рисуется кодом на Canvas: фоны регионов, препятствия, самолётик, монетки.
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

  /* Каменный великан Маньпупунёра: «шея», «голова», глянец, тень, лицо по желанию. */
  function stonePillar(g, x, base, w, h, tilt, face) {
    g.save();
    g.translate(x, base);
    g.rotate(tilt);
    function path(pad) {
      g.beginPath();
      g.moveTo(-w / 2 - pad, pad);
      g.bezierCurveTo(-w / 2 - 1 - pad, -h * 0.3, -w * 0.3 - pad, -h * 0.5, -w * 0.32 - pad, -h * 0.6);
      g.bezierCurveTo(-w * 0.34 - pad, -h * 0.72, -w * 0.55 - pad, -h * 0.8, -w * 0.42 - pad, -h * 0.94 - pad * 0.5);
      g.quadraticCurveTo(0, -h - 3 - pad, w * 0.42 + pad, -h * 0.92 - pad * 0.5);
      g.bezierCurveTo(w * 0.55 + pad, -h * 0.8, w * 0.34 + pad, -h * 0.72, w * 0.32 + pad, -h * 0.6);
      g.bezierCurveTo(w * 0.3 + pad, -h * 0.5, w / 2 + 1 + pad, -h * 0.3, w / 2 + pad, pad);
      g.closePath();
    }
    g.save();
    g.translate(w * 0.12, 2);
    path(0);
    g.fillStyle = 'rgba(60,30,110,0.35)';
    g.fill();
    g.restore();
    var gr = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    gr.addColorStop(0, '#F6EEFF');
    gr.addColorStop(0.5, '#BBA6E2');
    gr.addColorStop(1, '#7A64A8');
    path(0);
    g.fillStyle = gr;
    g.fill();
    gloss(g, -w * 0.18, -h * 0.35, w * 0.08, h * 0.16, 0.05, 0.55);
    if (face) {
      g.strokeStyle = '#3A1C8F';
      g.lineWidth = Math.max(1, w * 0.07);
      g.lineCap = 'round';
      [-1, 1].forEach(function (side) {
        g.beginPath();
        g.arc(side * w * 0.15, -h * 0.8, w * 0.07, 0.15 * Math.PI, 0.85 * Math.PI);
        g.stroke();
      });
      g.fillStyle = 'rgba(255,111,181,0.7)';
      ellipse(g, -w * 0.25, -h * 0.74, w * 0.08, w * 0.05);
      ellipse(g, w * 0.25, -h * 0.74, w * 0.08, w * 0.05);
    }
    g.restore();
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
            // далёкий город и монумент над Волгой
            var x0 = TILE * 0.3;
            var y0 = f(x0) + 2;
            g.fillStyle = 'rgba(255,255,255,0.9)';
            for (var i = 0; i < 9; i++) {
              var bx = x0 + 14 + i * 9;
              var bh = 5 + ((i * 7) % 5) * 2.4;
              g.fillRect(bx, f(bx) + 3 - bh, 7, bh);
            }
            g.fillStyle = '#ffffff';
            g.fillRect(x0 - 3, y0 - 25, 6, 26);
            g.fillStyle = '#FFC21A';
            g.beginPath();
            g.moveTo(x0, y0 - 38);
            g.lineTo(x0 + 4, y0 - 24);
            g.lineTo(x0 - 4, y0 - 24);
            g.closePath();
            g.fill();
            g.beginPath();
            g.moveTo(x0 - 11, y0 - 26);
            g.lineTo(x0, y0 - 34);
            g.lineTo(x0 + 11, y0 - 26);
            g.lineTo(x0 + 9, y0 - 24.5);
            g.lineTo(x0, y0 - 30);
            g.lineTo(x0 - 9, y0 - 24.5);
            g.closePath();
            g.fill();
            circle(g, x0, y0 - 39.5, 2);
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
            g.fillStyle = 'rgba(255,228,92,0.85)';
            for (i = 0; i < 4; i++) {
              wrapped(rand() * TILE, 60, function (x) {
                g.beginPath();
                g.moveTo(x, f(x) + 9);
                g.lineTo(x + 52, f(x + 52) + 9);
                g.lineTo(x + 46, f(x + 46) + 25);
                g.lineTo(x - 6, f(x - 6) + 25);
                g.closePath();
                g.fill();
              });
            }
            for (i = 0; i < 3; i++) {
              wrapped(rand() * TILE, 14, function (x) {
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
            // рощи по 2–3 дерева
            for (i = 0; i < 4; i++) {
              var cx = rand() * TILE;
              var n = 2 + Math.floor(rand() * 2);
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
        var petals = ['#ffffff', '#ffffff', '#FFB3EC', '#B9A2FF'];
        for (var i = 0; i < 26; i++) {
          var y = 586 + rand() * 44;
          var r = 1.8 + rand() * 1.2;
          var petal = petals[Math.floor(rand() * petals.length)];
          wrapped(rand() * TILE, 6, function (x) { flower(g, x, y, r, petal); });
        }
      }
    },

    /* Коми: фиолетово-розовое небо, лаймовое сияние, лавандовые горы, каменные великаны, надутые ёлки */
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
            var x0 = TILE * 0.36;
            var giants = [[0, 15, 50, -0.06, false], [22, 17, 62, 0.04, false], [44, 13, 44, -0.03, false],
              [66, 18, 66, 0.03, true], [90, 14, 52, -0.05, false], [112, 16, 58, 0.06, false], [182, 18, 56, -0.03, true]];
            giants.forEach(function (p) {
              var x = x0 + p[0] + rand() * 4;
              stonePillar(g, x, f(x) + 4, p[1], p[2], p[3], p[4]);
            });
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
        for (i = 0; i < 16; i++) {
          var rx = 5 + rand() * 7;
          var ry = 3 + rand() * 3;
          var y = 592 + rand() * 38;
          wrapped(rand() * TILE, rx + 2, function (x) {
            g.fillStyle = 'rgba(30,10,80,0.45)';
            ellipse(g, x + 1, y + 1.6, rx, ry);
            g.fillStyle = '#CDB8FF';
            ellipse(g, x, y, rx, ry);
            gloss(g, x - rx * 0.3, y - ry * 0.35, rx * 0.4, ry * 0.3, 0, 0.7);
          });
        }
        g.fillStyle = 'rgba(198,255,58,0.85)';
        for (i = 0; i < 40; i++) {
          circle(g, rand() * (TILE - 4) + 2, 584 + rand() * 52, 1 + rand() * 1.2);
        }
      }
    },

    /* Бурятия: ярко-голубое небо, глянцевый лёд Байкала, надутые сосны в снегу, нерпа */
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
            // нерпа на льду
            var nx = TILE * 0.62;
            var ny = 506;
            g.fillStyle = 'rgba(30,110,170,0.3)';
            ellipse(g, nx + 1, ny + 5, 16, 3.6);
            var seal = g.createLinearGradient(0, ny - 12, 0, ny + 7);
            seal.addColorStop(0, '#F2F4FF');
            seal.addColorStop(1, '#8792CC');
            g.fillStyle = seal;
            ellipse(g, nx, ny, 14, 7);
            circle(g, nx + 11, ny - 5, 6.2);
            g.fillStyle = '#2A1450';
            circle(g, nx + 9.2, ny - 6, 1.3);
            circle(g, nx + 13.2, ny - 6, 1.3);
            g.fillStyle = 'rgba(255,111,181,0.7)';
            circle(g, nx + 7.6, ny - 3.6, 1);
            circle(g, nx + 14.8, ny - 3.6, 1);
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

  /* ---------- самолётик с котом-пилотом ---------- */
  /* Стиль «альфа»: надутые глянцевые формы, мягкие тени, голографический хром.
     Неподвижные части рисуются один раз в спрайт с тенью, шарф и пропеллер — каждый кадр. */

  var PLANE_BOX = { x: -46, y: -44, w: 90, h: 66 };
  var spriteCache = {};
  var spriteKeys = [];

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

  function star5(g, x, y, r, fill, stroke) {
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var rr = i % 2 ? r * 0.45 : r;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
    g.lineJoin = 'round';
    g.strokeStyle = stroke;
    g.lineWidth = 1.4;
    g.stroke();
    g.fillStyle = fill;
    g.fill();
  }

  /* Кот-пилот: голова как из глянцевой глины, огромные глаза со звёздочками, румянец. */
  function drawCat(g) {
    var ear = g.createLinearGradient(0, -38, 0, -22);
    ear.addColorStop(0, '#FFB15C');
    ear.addColorStop(1, '#F07A2A');
    g.fillStyle = ear;
    g.beginPath();
    g.moveTo(-12.5, -22); g.quadraticCurveTo(-11, -34, -7.5, -37); g.quadraticCurveTo(-4, -32, -1.5, -27);
    g.moveTo(3.5, -27); g.quadraticCurveTo(6, -32, 9.5, -37); g.quadraticCurveTo(13, -34, 14.5, -22);
    g.fill();
    g.fillStyle = '#FF8FC8';
    g.beginPath();
    g.moveTo(-10, -24.5); g.quadraticCurveTo(-9, -31.5, -7.6, -33); g.quadraticCurveTo(-5.4, -29.5, -4, -26.5);
    g.moveTo(6, -26.5); g.quadraticCurveTo(7.4, -29.5, 9.6, -33); g.quadraticCurveTo(11, -31.5, 12, -24.5);
    g.fill();

    var head = g.createRadialGradient(-3, -25, 2, 1, -19, 15);
    head.addColorStop(0, '#FFD08A');
    head.addColorStop(0.55, '#FF9A3D');
    head.addColorStop(1, '#E8641C');
    g.fillStyle = head;
    ellipse(g, 1, -19, 13.5, 12);
    g.strokeStyle = 'rgba(200,80,10,0.5)';
    g.lineWidth = 1.6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-2, -30.4); g.lineTo(-1.5, -28.4);
    g.moveTo(1, -31); g.lineTo(1, -29);
    g.moveTo(4, -30.4); g.lineTo(3.5, -28.4);
    g.stroke();

    // очки лётчика: ремешок и голографические линзы
    g.fillStyle = '#3A1C8F';
    g.fillRect(-12, -26, 26, 2.6);
    [-4, 6].forEach(function (x) {
      var rim = g.createLinearGradient(x - 4.5, -29, x + 4.5, -21);
      rim.addColorStop(0, '#FFFFFF');
      rim.addColorStop(1, '#9AA3C7');
      g.fillStyle = rim;
      circle(g, x, -24.8, 4.6);
      g.fillStyle = holo(g, x - 3.5, -28, x + 3.5, -21);
      circle(g, x, -24.8, 3.4);
      gloss(g, x - 1.2, -26.2, 1.4, 0.8, -0.6, 0.9);
    });

    g.fillStyle = '#FFF4E6';
    ellipse(g, 1, -13, 6.6, 4.4);
    [-4.2, 6.2].forEach(function (x) {
      var eye = g.createLinearGradient(0, -22, 0, -13);
      eye.addColorStop(0, '#2A1450');
      eye.addColorStop(1, '#6A3CFF');
      g.fillStyle = eye;
      ellipse(g, x, -17.6, 3.1, 4.1);
      g.fillStyle = '#ffffff';
      circle(g, x + 1, -19.2, 1.25);
      circle(g, x - 1.1, -15.8, 0.6);
      sparkle(g, x - 0.5, -17.8, 1.3, 'rgba(255,255,255,0.95)');
    });
    g.fillStyle = 'rgba(255,90,170,0.45)';
    ellipse(g, -8.4, -12.8, 2.6, 1.6);
    ellipse(g, 10.4, -12.8, 2.6, 1.6);
    g.fillStyle = '#FF5FA2';
    g.beginPath();
    g.moveTo(-0.4, -15.2); g.lineTo(2.4, -15.2); g.lineTo(1, -13.8);
    g.closePath();
    g.fill();
    g.strokeStyle = '#5A2A1A';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(-1.6, -12.6);
    g.quadraticCurveTo(-0.3, -11.3, 1, -12.8);
    g.quadraticCurveTo(2.3, -11.3, 3.6, -12.6);
    g.stroke();
    gloss(g, -5.5, -28.6, 3.4, 1.6, -0.4, 0.55);
  }

  /* Неподвижная часть: хвост, кот, фюзеляж, крыло, козырёк, нос. */
  function drawPlaneBody(g) {
    var tail = g.createLinearGradient(-36, -26, -20, -2);
    tail.addColorStop(0, '#FFA6E6');
    tail.addColorStop(1, '#E5359A');
    g.fillStyle = tail;
    g.beginPath();
    g.moveTo(-27, -2); g.lineTo(-36, -21); g.quadraticCurveTo(-36, -26, -30.5, -25); g.lineTo(-17, -6);
    g.closePath();
    g.fill();
    gloss(g, -31, -18, 1.3, 4, -0.45, 0.6);

    drawCat(g);

    var body = g.createLinearGradient(0, -12, 0, 11);
    body.addColorStop(0, '#E6FF7A');
    body.addColorStop(0.45, '#7BEA3E');
    body.addColorStop(1, '#16A34A');
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(-33, -3);
    g.bezierCurveTo(-30, -11, 18, -13, 27, -6);
    g.quadraticCurveTo(31, -1, 27, 5);
    g.bezierCurveTo(16, 12, -26, 10, -33, 3);
    g.quadraticCurveTo(-35, 0, -33, -3);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(210,255,160,0.7)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-26, 6.4);
    g.bezierCurveTo(-10, 10, 12, 10, 24, 5);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.moveTo(-25, -5.5);
    g.bezierCurveTo(-18, -9.5, -4, -10, 4, -9.6);
    g.bezierCurveTo(-4, -8, -16, -7, -25, -3.6);
    g.closePath();
    g.fill();
    gloss(g, 18, -7.5, 3.2, 1.3, -0.15, 0.8);
    star5(g, -14, 1.5, 4.4, '#FFE14D', '#E89A00');

    g.fillStyle = '#3A1C8F';
    ellipse(g, 1, -9.2, 11.5, 2.6);

    var wing = g.createLinearGradient(0, 1, 0, 12);
    wing.addColorStop(0, '#FF9BE0');
    wing.addColorStop(1, '#D92E8E');
    g.fillStyle = wing;
    ellipse(g, -3, 6.5, 17.5, 5.2);
    gloss(g, -7, 4.6, 9, 1.4, 0, 0.65);

    g.globalAlpha = 0.85;
    g.fillStyle = holo(g, 9, -19, 17, -9);
    g.beginPath();
    g.moveTo(9, -9.6);
    g.quadraticCurveTo(11, -19.5, 17, -10.2);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;

    var nose = g.createRadialGradient(26, -3, 0.5, 28, -0.5, 7);
    nose.addColorStop(0, '#FFFFFF');
    nose.addColorStop(0.35, '#BDF6FF');
    nose.addColorStop(0.7, '#FFB3EC');
    nose.addColorStop(1, '#9B86FF');
    g.fillStyle = nose;
    ellipse(g, 28, -0.5, 5.6, 6.8);
    g.fillStyle = '#ffffff';
    circle(g, 33, -0.5, 2.4);
  }

  /* Спрайт под текущий масштаб: рисунок и мягкая тень под ним. */
  function planeSprite(es) {
    var key = es.toFixed(2);
    if (spriteCache[key]) return spriteCache[key];
    var b = PLANE_BOX;
    var cw = Math.ceil(b.w * es);
    var ch = Math.ceil(b.h * es);
    var art = makeCanvas(cw, ch);
    var ga = art.getContext('2d');
    ga.setTransform(es, 0, 0, es, -b.x * es, -b.y * es);
    drawPlaneBody(ga);

    var shadow = makeCanvas(cw, ch);
    var gsh = shadow.getContext('2d');
    gsh.drawImage(art, 0, 0);
    gsh.globalCompositeOperation = 'source-in';
    gsh.fillStyle = '#2A0A5A';
    gsh.fillRect(0, 0, cw, ch);

    var sprite = makeCanvas(cw, ch);
    var gs = sprite.getContext('2d');
    gs.globalAlpha = 0.25;
    gs.drawImage(shadow, 0, 3 * es);
    gs.globalAlpha = 1;
    gs.drawImage(art, 0, 0);

    spriteCache[key] = sprite;
    spriteKeys.push(key);
    if (spriteKeys.length > 4) delete spriteCache[spriteKeys.shift()];
    return sprite;
  }

  function drawScarf(g, t) {
    var wave = Math.sin(t * 12);
    var grad = g.createLinearGradient(-36, 0, -4, 0);
    grad.addColorStop(0, '#FFB020');
    grad.addColorStop(1, '#FF3DA8');
    g.beginPath();
    g.moveTo(-3, -13);
    g.quadraticCurveTo(-18, -16 + wave * 3, -36, -12 + wave * 5);
    g.quadraticCurveTo(-33, -8.5 + wave * 5, -35, -5 + wave * 5);
    g.quadraticCurveTo(-18, -9 + wave * 2, -3, -7);
    g.closePath();
    g.fillStyle = grad;
    g.fill();
  }

  function drawPropeller(g, t) {
    var disc = g.createLinearGradient(0, -19, 0, 18);
    disc.addColorStop(0, 'rgba(142,241,255,0.4)');
    disc.addColorStop(0.5, 'rgba(255,179,236,0.4)');
    disc.addColorStop(1, 'rgba(185,162,255,0.4)');
    g.fillStyle = disc;
    ellipse(g, 35, -0.5, 2.8, 18);
    g.fillStyle = '#3A1C8F';
    ellipse(g, 35, -0.5, 1.9, Math.max(2.2, 17 * Math.abs(Math.cos(t * 55))));
    g.fillStyle = '#ffffff';
    circle(g, 35, -0.5, 1.6);
  }

  function drawPlane(ctx, x, y, rot, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    var m = ctx.getTransform ? ctx.getTransform() : null;
    var es = m ? Math.sqrt(m.a * m.a + m.b * m.b) : scale;
    es = Math.max(0.5, Math.round(es * 4) / 4);
    drawScarf(ctx, t);
    var b = PLANE_BOX;
    ctx.drawImage(planeSprite(es), b.x, b.y, b.w, b.h);
    drawPropeller(ctx, t);
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
    drawPlane: drawPlane,
    drawCoin: drawCoin
  };
})();
