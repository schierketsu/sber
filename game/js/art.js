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

  /* Чувашский орнамент: цепочка ромбов между двумя чёрными линиями. */
  function ornamentBand(g, x, y, w, h, step) {
    g.fillStyle = '#f6eedf';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#2b1d1d';
    g.fillRect(x, y, w, 1.6);
    g.fillRect(x, y + h - 1.6, w, 1.6);
    var cy = y + h / 2;
    var ry = h / 2 - 4;
    for (var cx = x + step / 2; cx < x + w; cx += step) {
      var rx = step * 0.42;
      g.fillStyle = '#c8312f';
      g.beginPath();
      g.moveTo(cx - rx, cy);
      g.lineTo(cx, cy - ry);
      g.lineTo(cx + rx, cy);
      g.lineTo(cx, cy + ry);
      g.closePath();
      g.fill();
      g.fillStyle = '#f6eedf';
      g.beginPath();
      g.moveTo(cx - rx * 0.4, cy);
      g.lineTo(cx, cy - ry * 0.4);
      g.lineTo(cx + rx * 0.4, cy);
      g.lineTo(cx, cy + ry * 0.4);
      g.closePath();
      g.fill();
      g.fillStyle = '#2b1d1d';
      circle(g, cx, cy, Math.max(1, ry * 0.14));
    }
  }

  /* ---------- сцены регионов ---------- */

  var SCENES = {
    /* Чувашия: летняя Волга, холмы, поля, вышитая земля */
    volga: {
      sky: function (g, w) {
        g.fillStyle = vGradient(g, 0, H, [[0, '#58b7f2'], [0.5, '#a9defc'], [0.8, '#fff0c9'], [1, '#ffe0a3']]);
        g.fillRect(0, 0, w, H);
        sun(g, w * 0.74, 118, 30, 'rgba(255,240,170,0.6)', '#fff6c4', '#ffd45c');
      },
      layers: [
        {
          top: 40, h: 240, factor: 0.05,
          draw: function (g, rand) { clouds(g, rand, 6, 90, 230, '#ffffff', 'rgba(140,185,220,0.35)'); }
        },
        {
          top: 360, h: 140, factor: 0.12,
          draw: function (g, rand) {
            var f = profile(rand, 7, 394, 430, true);
            g.fillStyle = '#a3cfb3';
            fillProfile(g, f, 470);
            // далёкий город и монумент над Волгой
            var x0 = TILE * 0.3;
            var y0 = f(x0) + 2;
            g.fillStyle = '#d6e3e4';
            for (var i = 0; i < 9; i++) {
              var bx = x0 + 14 + i * 9;
              var bh = 5 + ((i * 7) % 5) * 2.4;
              g.fillRect(bx, f(bx) + 3 - bh, 7, bh);
            }
            g.fillStyle = '#efe9dc';
            g.fillRect(x0 - 2, y0 - 24, 4, 24);
            g.fillStyle = '#d4a640';
            g.beginPath();
            g.moveTo(x0, y0 - 37);
            g.lineTo(x0 + 3.4, y0 - 24);
            g.lineTo(x0 - 3.4, y0 - 24);
            g.closePath();
            g.fill();
            g.beginPath();
            g.moveTo(x0 - 10, y0 - 27);
            g.lineTo(x0, y0 - 33);
            g.lineTo(x0 + 10, y0 - 27);
            g.lineTo(x0 + 9, y0 - 25.5);
            g.lineTo(x0, y0 - 30);
            g.lineTo(x0 - 9, y0 - 25.5);
            g.closePath();
            g.fill();
            circle(g, x0, y0 - 38.5, 1.8);
            // Волга
            g.fillStyle = vGradient(g, 452, 500, [[0, '#8fd0ef'], [1, '#68b6df']]);
            g.fillRect(0, 452, TILE, 48);
            g.fillStyle = 'rgba(255,255,255,0.5)';
            for (var k = 0; k < 28; k++) {
              var len = 10 + rand() * 26;
              g.fillRect(rand() * (TILE - len), 457 + rand() * 38, len, 1.6);
            }
          }
        },
        {
          top: 440, h: 140, factor: 0.28,
          draw: function (g, rand) {
            var f = profile(rand, 5, 478, 506, true);
            g.fillStyle = '#71bd5e';
            fillProfile(g, f, 580);
            var i;
            g.fillStyle = 'rgba(240,214,100,0.6)';
            for (i = 0; i < 5; i++) {
              wrapped(rand() * TILE, 60, function (x) {
                g.beginPath();
                g.moveTo(x, f(x) + 7);
                g.lineTo(x + 52, f(x + 52) + 7);
                g.lineTo(x + 46, f(x + 46) + 24);
                g.lineTo(x - 6, f(x - 6) + 24);
                g.closePath();
                g.fill();
              });
            }
            for (i = 0; i < 3; i++) {
              wrapped(rand() * TILE, 12, function (x) {
                var y = f(x) + 5;
                g.fillStyle = '#e2b07a';
                g.fillRect(x - 8, y - 12, 16, 12);
                g.fillStyle = '#b8452f';
                g.beginPath();
                g.moveTo(x - 10, y - 12);
                g.lineTo(x, y - 21);
                g.lineTo(x + 10, y - 12);
                g.closePath();
                g.fill();
                g.fillStyle = '#7fc3e8';
                g.fillRect(x - 3, y - 9, 6, 5);
              });
            }
            for (i = 0; i < 14; i++) {
              var r = 7 + rand() * 5;
              wrapped(rand() * TILE, r + 2, function (x) {
                var y = f(x) + 3;
                g.fillStyle = '#6b4a2b';
                g.fillRect(x - 1.3, y - r * 0.7, 2.6, r * 0.8);
                g.fillStyle = '#3f8f48';
                circle(g, x, y - r * 1.15, r);
                g.fillStyle = 'rgba(255,255,255,0.13)';
                circle(g, x - r * 0.3, y - r * 1.45, r * 0.5);
              });
            }
          }
        },
        {
          top: 500, h: 80, factor: 0.5,
          draw: function (g, rand) {
            var f = profile(rand, 9, 534, 552, true);
            g.fillStyle = '#3f9147';
            fillProfile(g, f, 580);
            for (var i = 0; i < 16; i++) {
              var r = 8 + rand() * 8;
              wrapped(rand() * TILE, r, function (x) {
                var y = f(x) + 5;
                g.fillStyle = '#37803f';
                circle(g, x, y, r);
                g.fillStyle = '#4aa253';
                circle(g, x - r * 0.15, y - r * 0.2, r * 0.8);
              });
            }
          }
        }
      ],
      ground: function (g) {
        g.fillStyle = '#f6eedf';
        g.fillRect(0, GROUND, TILE, H - GROUND);
        g.fillStyle = '#79c64d';
        g.fillRect(0, GROUND, TILE, 9);
        g.fillStyle = '#5aa83a';
        g.fillRect(0, GROUND + 8, TILE, 2.5);
        ornamentBand(g, 0, 590, TILE, 34, 32);
      }
    },

    /* Коми: вечерний Урал, северное сияние, каменные столбы, тайга */
    ural: {
      sky: function (g, w, rand) {
        g.fillStyle = vGradient(g, 0, H, [[0, '#1d2456'], [0.45, '#4c4d8e'], [0.78, '#c792b2'], [1, '#ffc8a0']]);
        g.fillRect(0, 0, w, H);
        for (var i = 0; i < 55; i++) {
          g.fillStyle = 'rgba(255,255,255,' + (0.35 + rand() * 0.6).toFixed(2) + ')';
          circle(g, rand() * w, rand() * H * 0.42, 0.6 + rand() * 1.2);
        }
        g.lineCap = 'round';
        var widths = [30, 16, 6];
        var alphas = [0.07, 0.11, 0.22];
        for (var k = 0; k < 3; k++) {
          for (var j = 0; j < widths.length; j++) {
            g.strokeStyle = (k === 1 ? 'rgba(90,230,220,' : 'rgba(120,255,170,') + alphas[j] + ')';
            g.lineWidth = widths[j];
            g.beginPath();
            for (var x = -20; x <= w + 20; x += 8) {
              var y = 70 + k * 34 + Math.sin(x * 0.012 + k * 1.7) * 18 + Math.sin(x * 0.031 + k) * 6;
              if (x === -20) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.stroke();
          }
        }
      },
      layers: [
        {
          top: 150, h: 140, factor: 0.04,
          draw: function (g, rand) {
            g.fillStyle = 'rgba(255,190,210,0.28)';
            for (var i = 0; i < 6; i++) {
              var rx = 40 + rand() * 50;
              var y = 175 + rand() * 95;
              var ry = 4 + rand() * 4;
              wrapped(rand() * TILE, rx, function (x) { ellipse(g, x, y, rx, ry); });
            }
          }
        },
        {
          top: 250, h: 270, factor: 0.1,
          draw: function (g, rand) {
            var f = profile(rand, 16, 300, 440, false);
            snowyMountains(g, f, 520, vGradient(g, 300, 520, [[0, '#8f97c6'], [1, '#626c9f']]), 385);
          }
        },
        {
          top: 400, h: 170, factor: 0.2,
          draw: function (g, rand) {
            var f = profile(rand, 5, 470, 484, true);
            g.fillStyle = '#857a95';
            fillProfile(g, f, 570);
            // семь каменных великанов: шесть в ряд и один поодаль
            var x0 = TILE * 0.38;
            var spots = [0, 22, 41, 63, 84, 104, 175];
            for (var i = 0; i < spots.length; i++) {
              var x = x0 + spots[i] + rand() * 6;
              var w = 11 + rand() * 7;
              var h = 36 + rand() * 28;
              var base = f(x) + 3;
              var j1 = rand() * 3;
              var j2 = rand() * 3;
              g.beginPath();
              g.moveTo(x - w / 2, base);
              g.lineTo(x - w / 2 - 1 + j1, base - h * 0.35);
              g.lineTo(x - w / 2 + 2, base - h * 0.72);
              g.lineTo(x - w * 0.28, base - h);
              g.lineTo(x + w * 0.22, base - h - 2);
              g.lineTo(x + w / 2 - 1, base - h * 0.62);
              g.lineTo(x + w / 2 + 1 - j2, base - h * 0.3);
              g.lineTo(x + w / 2, base);
              g.closePath();
              g.fillStyle = '#a99aa0';
              g.fill();
              g.save();
              g.clip();
              g.fillStyle = 'rgba(55,35,60,0.28)';
              g.fillRect(x + w * 0.08, base - h - 4, w, h + 6);
              g.restore();
            }
          }
        },
        {
          top: 420, h: 160, factor: 0.42,
          draw: function (g, rand) {
            g.fillStyle = '#21483a';
            g.fillRect(0, 556, TILE, 24);
            var trees = [];
            for (var i = 0; i < 26; i++) {
              trees.push({ x: rand() * TILE, h: 50 + rand() * 62, base: 562 + rand() * 14, dark: rand() < 0.5 });
            }
            trees.sort(function (a, b) { return a.base - b.base; });
            trees.forEach(function (t) {
              wrapped(t.x, t.h * 0.4, function (x) { fir(g, x, t.base, t.h, t.dark ? '#1a3f32' : '#1f4a3a', false); });
            });
          }
        }
      ],
      ground: function (g, rand) {
        g.fillStyle = vGradient(g, GROUND, H, [[0, '#5a6440'], [1, '#434b31']]);
        g.fillRect(0, GROUND, TILE, H - GROUND);
        g.fillStyle = '#8eaa4c';
        g.fillRect(0, GROUND, TILE, 8);
        var i;
        for (i = 0; i < 18; i++) {
          var rx = 5 + rand() * 7;
          var ry = 3 + rand() * 3;
          var y = 590 + rand() * 40;
          wrapped(rand() * TILE, rx, function (x) {
            g.fillStyle = '#8e9088';
            ellipse(g, x, y, rx, ry);
            g.fillStyle = 'rgba(255,255,255,0.2)';
            ellipse(g, x - rx * 0.25, y - ry * 0.3, rx * 0.5, ry * 0.4);
          });
        }
        g.fillStyle = 'rgba(200,208,122,0.75)';
        for (i = 0; i < 44; i++) {
          var lx = rand() * (TILE - 4) + 2;
          circle(g, lx, 582 + rand() * 54, 1 + rand() * 1.2);
        }
      }
    },

    /* Бурятия: зимний Байкал, прозрачный лёд, нерпа, снежные сосны */
    baikal: {
      sky: function (g, w) {
        g.fillStyle = vGradient(g, 0, H, [[0, '#0f62c6'], [0.5, '#57b4f2'], [0.85, '#cbedff'], [1, '#eef9ff']]);
        g.fillRect(0, 0, w, H);
        sun(g, w * 0.22, 96, 24, 'rgba(255,255,255,0.7)', '#ffffff', '#fff3cf');
      },
      layers: [
        {
          top: 40, h: 220, factor: 0.05,
          draw: function (g, rand) { clouds(g, rand, 4, 90, 220, '#ffffff', 'rgba(120,170,220,0.3)'); }
        },
        {
          top: 320, h: 160, factor: 0.1,
          draw: function (g, rand) {
            var f = profile(rand, 13, 350, 428, false);
            snowyMountains(g, f, 470, vGradient(g, 350, 470, [[0, '#6b92c8'], [1, '#4d78b3']]), 405);
          }
        },
        {
          top: 440, h: 120, factor: 0.24,
          draw: function (g, rand) {
            g.fillStyle = vGradient(g, 455, 556, [[0, '#aee8f4'], [1, '#62c3de']]);
            g.fillRect(0, 455, TILE, 101);
            g.fillStyle = 'rgba(255,255,255,0.65)';
            g.fillRect(0, 455, TILE, 2);
            var i;
            for (i = 0; i < 14; i++) {
              var cy = 464 + rand() * 76;
              var seed = Math.floor(rand() * 100000);
              wrapped(rand() * TILE, 120, function (x) { crack(g, rng(seed), x, cy, 5, 'rgba(255,255,255,0.55)', 1.2); });
            }
            for (i = 0; i < 8; i++) {
              var hy = 472 + rand() * 60;
              var hs = 0.7 + rand() * 0.6;
              wrapped(rand() * TILE, 20, function (x) {
                for (var k = 0; k < 3; k++) {
                  var px = x + (k - 1) * 8 * hs;
                  var ph = (10 + (k === 1 ? 6 : 0)) * hs;
                  g.fillStyle = '#d8f7fd';
                  g.beginPath();
                  g.moveTo(px - 6 * hs, hy);
                  g.lineTo(px, hy - ph);
                  g.lineTo(px + 6 * hs, hy);
                  g.closePath();
                  g.fill();
                  g.fillStyle = 'rgba(80,170,205,0.45)';
                  g.beginPath();
                  g.moveTo(px, hy - ph);
                  g.lineTo(px + 6 * hs, hy);
                  g.lineTo(px + 1 * hs, hy);
                  g.closePath();
                  g.fill();
                }
              });
            }
            // нерпа на льду
            var nx = TILE * 0.62;
            var ny = 508;
            g.fillStyle = 'rgba(40,90,120,0.25)';
            ellipse(g, nx, ny + 6, 15, 3);
            g.fillStyle = '#7d8796';
            ellipse(g, nx, ny, 13, 6.5);
            g.fillStyle = '#8b95a4';
            circle(g, nx + 10, ny - 4, 5.6);
            g.fillStyle = '#1d2530';
            circle(g, nx + 8.6, ny - 5, 1);
            circle(g, nx + 12, ny - 5, 1);
            circle(g, nx + 10.3, ny - 2.8, 0.8);
          }
        },
        {
          top: 490, h: 90, factor: 0.48,
          draw: function (g, rand) {
            var f = profile(rand, 8, 534, 552, true);
            g.fillStyle = '#f3f9ff';
            fillProfile(g, f, 580);
            g.fillStyle = '#d9e9f7';
            g.fillRect(0, 568, TILE, 12);
            for (var i = 0; i < 10; i++) {
              var h = 40 + rand() * 40;
              wrapped(rand() * TILE, h * 0.4, function (x) { fir(g, x, f(x) + 6, h, '#2b5b4d', true); });
            }
          }
        }
      ],
      ground: function (g, rand) {
        g.fillStyle = vGradient(g, GROUND, H, [[0, '#c8f1fa'], [1, '#6cc6e0']]);
        g.fillRect(0, GROUND, TILE, H - GROUND);
        g.fillStyle = '#effcff';
        g.fillRect(0, GROUND, TILE, 5);
        var i;
        for (i = 0; i < 20; i++) {
          var by = 596 + rand() * 32;
          var n = 3 + Math.floor(rand() * 4);
          wrapped(rand() * TILE, 6, function (x) {
            for (var k = 0; k < n; k++) {
              var r = 3.4 - k * 0.45;
              if (r <= 0.8) break;
              g.fillStyle = 'rgba(255,255,255,0.35)';
              circle(g, x + (k % 2) * 1.5, by - k * 6, r);
              g.strokeStyle = 'rgba(255,255,255,0.85)';
              g.lineWidth = 0.8;
              g.stroke();
            }
          });
        }
        for (i = 0; i < 6; i++) {
          var cy = 584 + rand() * 46;
          var seed = Math.floor(rand() * 100000);
          wrapped(rand() * TILE, 120, function (x) { crack(g, rng(seed), x, cy, 5, 'rgba(255,255,255,0.6)', 1); });
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
    pillar: function (g) {
      var w = OB_W + CAP * 2;
      var body = g.createLinearGradient(CAP, 0, CAP + OB_W, 0);
      body.addColorStop(0, '#b88a52');
      body.addColorStop(0.35, '#efd5a5');
      body.addColorStop(0.7, '#e1bf86');
      body.addColorStop(1, '#a87a45');
      g.fillStyle = body;
      g.fillRect(CAP, 0, OB_W, H);
      g.strokeStyle = 'rgba(110,70,30,0.18)';
      g.lineWidth = 1;
      for (var i = 0; i < 7; i++) {
        var gx = CAP + 6 + i * 8.5;
        g.beginPath();
        g.moveTo(gx, 0);
        for (var y = 0; y <= H; y += 20) g.lineTo(gx + Math.sin(y * 0.05 + i) * 1.5, y);
        g.stroke();
      }
      for (var by = 52; by < H; by += 96) ornamentBand(g, CAP, by, OB_W, 24, 16);
      roundRect(g, 0, 0, w, 22, 5);
      g.fillStyle = '#9c6a36';
      g.fill();
      g.fillStyle = '#c8312f';
      g.fillRect(0, 8, w, 5);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(3, 2, w - 6, 3);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(2, 19, w - 4, 3);
    },
    rock: function (g) {
      var r = rng(31);
      var w = OB_W + CAP * 2;
      var left = [];
      var right = [];
      for (var y = 0; y <= H + 16; y += 16) {
        left.push([CAP + 2 + r() * 6, y]);
        right.push([CAP + OB_W - 2 - r() * 6, y]);
      }
      g.beginPath();
      g.moveTo(left[0][0], left[0][1]);
      left.forEach(function (p) { g.lineTo(p[0], p[1]); });
      right.slice().reverse().forEach(function (p) { g.lineTo(p[0], p[1]); });
      g.closePath();
      var body = g.createLinearGradient(CAP, 0, CAP + OB_W, 0);
      body.addColorStop(0, '#8a786a');
      body.addColorStop(0.4, '#b4a292');
      body.addColorStop(1, '#6f5f53');
      g.fillStyle = body;
      g.fill();
      g.save();
      g.clip();
      g.strokeStyle = 'rgba(60,45,35,0.28)';
      g.lineWidth = 1.5;
      for (var sy = 30; sy < H; sy += 14 + r() * 12) {
        g.beginPath();
        g.moveTo(0, sy);
        for (var sx = 0; sx <= w; sx += 8) g.lineTo(sx, sy + Math.sin(sx * 0.2 + sy) * 1.8);
        g.stroke();
      }
      g.fillStyle = 'rgba(190,200,110,0.45)';
      for (var i = 0; i < 34; i++) circle(g, CAP + 4 + r() * (OB_W - 8), 30 + r() * (H - 40), 1.5 + r() * 2.5);
      g.restore();
      roundRect(g, 0, 0, w, 26, 12);
      g.fillStyle = '#9d8b7b';
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.18)';
      ellipse(g, w * 0.4, 7, w * 0.3, 3.5);
      g.fillStyle = 'rgba(40,30,25,0.25)';
      g.fillRect(4, 22, w - 8, 3);
    },
    ice: function (g) {
      var r = rng(53);
      var w = OB_W + CAP * 2;
      var body = g.createLinearGradient(CAP, 0, CAP + OB_W, 0);
      body.addColorStop(0, 'rgba(214,248,255,0.97)');
      body.addColorStop(0.5, 'rgba(150,222,240,0.97)');
      body.addColorStop(1, 'rgba(96,190,222,0.97)');
      g.fillStyle = body;
      g.fillRect(CAP, 0, OB_W, H);
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.fillRect(CAP + 10, 0, 7, H);
      g.fillStyle = 'rgba(255,255,255,0.22)';
      g.fillRect(CAP + 22, 0, 3, H);
      g.fillStyle = 'rgba(40,120,160,0.22)';
      g.fillRect(CAP + OB_W - 12, 0, 2, H);
      for (var i = 0; i < 9; i++) crack(g, r, CAP + 4, 40 + r() * (H - 60), 3, 'rgba(255,255,255,0.45)', 1);
      for (var k = 0; k < 20; k++) {
        g.fillStyle = 'rgba(255,255,255,0.55)';
        circle(g, CAP + 8 + r() * (OB_W - 16), 40 + r() * (H - 60), 1 + r() * 1.6);
      }
      roundRect(g, 0, 0, w, 20, 9);
      g.fillStyle = '#f4fcff';
      g.fill();
      for (var bx = 6; bx < w; bx += 12) circle(g, bx, 18, 5);
      g.fillStyle = 'rgba(120,180,210,0.35)';
      g.fillRect(3, 21, w - 6, 2);
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

  function drawCat(g) {
    g.fillStyle = '#f08a3c';
    g.beginPath();
    g.moveTo(-10, -21); g.lineTo(-7, -33); g.lineTo(-1.5, -25);
    g.moveTo(1.5, -25); g.lineTo(7, -33); g.lineTo(10, -21);
    g.fill();
    g.fillStyle = '#ffb3a7';
    g.beginPath();
    g.moveTo(-8, -23); g.lineTo(-6.6, -29.5); g.lineTo(-3.6, -25);
    g.moveTo(3.6, -25); g.lineTo(6.6, -29.5); g.lineTo(8, -23);
    g.fill();
    g.fillStyle = '#f59a46';
    ellipse(g, 0, -18, 11.5, 10);
    g.strokeStyle = '#d9732a';
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-3, -27); g.lineTo(-2.4, -24.2);
    g.moveTo(0, -27.6); g.lineTo(0, -24.6);
    g.moveTo(3, -27); g.lineTo(2.4, -24.2);
    g.stroke();
    // очки лётчика на лбу
    g.fillStyle = '#5b3a29';
    g.fillRect(-11.2, -23.6, 22.4, 2.2);
    g.fillStyle = '#9fe0ff';
    g.strokeStyle = '#4a2f22';
    g.lineWidth = 1.5;
    [-4.6, 4.6].forEach(function (x) {
      g.beginPath();
      g.arc(x, -22.6, 3.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    });
    g.fillStyle = 'rgba(255,255,255,0.8)';
    circle(g, -5.6, -23.6, 1);
    circle(g, 3.6, -23.6, 1);
    // мордочка
    g.fillStyle = '#fff3e6';
    ellipse(g, 0, -13.2, 5.6, 3.8);
    g.fillStyle = '#1f1a17';
    ellipse(g, -4.2, -17, 1.7, 2.3);
    ellipse(g, 4.2, -17, 1.7, 2.3);
    g.fillStyle = '#ffffff';
    circle(g, -3.7, -17.8, 0.65);
    circle(g, 4.7, -17.8, 0.65);
    g.fillStyle = 'rgba(255,120,120,0.35)';
    circle(g, -7.4, -13.6, 2);
    circle(g, 7.4, -13.6, 2);
    g.fillStyle = '#ff7d8a';
    g.beginPath();
    g.moveTo(-1.3, -14.6); g.lineTo(1.3, -14.6); g.lineTo(0, -13.2);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(122,74,42,0.6)';
    g.lineWidth = 0.7;
    g.beginPath();
    g.moveTo(0, -13.2); g.lineTo(0, -12);
    g.moveTo(-5, -13); g.lineTo(-12, -14.2);
    g.moveTo(-5, -12); g.lineTo(-12, -11);
    g.moveTo(5, -13); g.lineTo(12, -14.2);
    g.moveTo(5, -12); g.lineTo(12, -11);
    g.stroke();
  }

  function drawPlane(ctx, x, y, rot, t) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    var wave = Math.sin(t * 12);
    // шарф развевается позади
    ctx.fillStyle = '#e8413c';
    ctx.beginPath();
    ctx.moveTo(-3, -12);
    ctx.quadraticCurveTo(-17, -15 + wave * 3, -32, -11 + wave * 5);
    ctx.lineTo(-30, -5 + wave * 5);
    ctx.quadraticCurveTo(-17, -8 + wave * 2, -3, -7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-24, -12 + wave * 4, 3, 5);
    // хвост
    ctx.fillStyle = '#178a33';
    ctx.beginPath();
    ctx.moveTo(-25, -3); ctx.lineTo(-34, -20); ctx.lineTo(-27, -21); ctx.lineTo(-17, -6);
    ctx.closePath();
    ctx.fill();
    drawCat(ctx);
    // фюзеляж
    var body = ctx.createLinearGradient(0, -11, 0, 10);
    body.addColorStop(0, '#45d36a');
    body.addColorStop(1, '#1d9a3b');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(-31, -4);
    ctx.bezierCurveTo(-12, -11, 16, -11, 25, -6);
    ctx.lineTo(27, 4);
    ctx.bezierCurveTo(14, 10, -14, 9, -31, 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(-28, -0.5);
    ctx.bezierCurveTo(-10, -3.5, 12, -3.5, 25, -1.5);
    ctx.lineTo(25.5, 1.2);
    ctx.bezierCurveTo(12, -0.6, -10, -0.6, -28, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0f3d1d';
    ellipse(ctx, 1, -8.6, 10, 2.4);
    // крыло
    ctx.fillStyle = '#147a2e';
    ellipse(ctx, -3, 5, 16, 4.2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ellipse(ctx, -5, 3.6, 11, 1.4);
    // козырёк
    ctx.fillStyle = 'rgba(205,240,255,0.65)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(9, -9);
    ctx.quadraticCurveTo(11, -18, 15, -9.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // нос и пропеллер
    ctx.fillStyle = '#eef2f1';
    ellipse(ctx, 27, -1, 4.5, 5.6);
    ctx.fillStyle = '#c3cbc8';
    circle(ctx, 31, -1, 2.2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ellipse(ctx, 32, -1, 2.6, 17);
    ctx.fillStyle = 'rgba(60,60,60,0.85)';
    ellipse(ctx, 32, -1, 1.8, Math.max(2, 16 * Math.abs(Math.cos(t * 55))));
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
    var face = ctx.createLinearGradient(-11, -11, 11, 11);
    face.addColorStop(0, '#fff09a');
    face.addColorStop(0.5, '#ffc93a');
    face.addColorStop(1, '#e79a12');
    ctx.fillStyle = face;
    circle(ctx, 0, 0, 11);
    ctx.strokeStyle = '#c47f0c';
    ctx.lineWidth = 2;
    ctx.stroke();
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
