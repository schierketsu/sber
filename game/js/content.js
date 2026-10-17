/* Контент игры: регионы, открытки, монетки.
   Источник — content/regions.json рядом с игрой (контент-менеджер меняет его без релиза).
   Если файл не загрузился или битый, игра берёт встроенную копию ниже. */
(function () {
  'use strict';

  var CONTENT_URL = 'content/regions.json';
  var LOAD_TIMEOUT_MS = 2500;
  var SCENES = ['volga', 'ural', 'baikal'];
  var OBSTACLES = ['pillar', 'rock', 'ice'];
  var COLORS = ['#FF7A1A', '#7B4DFF', '#1F86FF'];

  var DEFAULT_CONTENT = {
    title: 'Кот-пилот',
    subtitle: 'Полёт над Россией',
    pointsPerCard: 10,
    coin: { chance: 0.35, value: 2 },
    regions: [
      {
        id: 'chuvashia', name: 'Чувашия', nameTo: 'в Чувашию',
        scene: 'volga', color: '#FF7A1A', obstacle: 'pillar', speed: 115, gap: 190,
        cards: [
          {
            title: 'Космическая родина',
            text: 'Чувашия — родина Андрияна Николаева, третьего советского космонавта. Он стал первым в мире, кто отвязался от кресла в невесомости и парил внутри корабля, а ещё первым спел в космосе песню!',
            image: 'img/cards/cosmonaut.svg'
          },
          {
            title: 'Дерево-великан',
            text: 'В чувашском лесу растёт Старейшина чувашских дубов. Ему больше 420 лет! Чтобы обнять его огромный ствол, понадобится целая цепочка из 4–5 детей.',
            image: 'img/cards/oak.svg'
          }
        ]
      },
      {
        id: 'komi', name: 'Коми', nameTo: 'в Коми',
        scene: 'ural', color: '#7B4DFF', obstacle: 'rock', speed: 122, gap: 180,
        cards: [
          {
            title: 'Югыд Ва',
            text: '«Югыд Ва» на языке коми значит «светлая вода». Это один из самых больших национальных парков России — он раскинулся на склонах Уральских гор. По горам парка проходит граница между Европой и Азией.\n\nЛеса Коми стали первым природным местом России в списке Всемирного наследия ЮНЕСКО.',
            image: 'img/cards/yugyd-va.svg'
          },
          {
            title: 'Маньпупунёр — каменные великаны',
            text: 'По соседству с «Югыд Ва», в Печоро-Илычском заповеднике, на плато стоят семь каменных столбов высотой от 30 до 42 метров.\n\nКогда-то здесь были высокие горы. Ветер, дождь и мороз миллионы лет разрушали мягкий камень, а твёрдые столбы остались. В 2008 году Маньпупунёр выбрали одним из семи чудес России.',
            image: 'img/cards/manpupuner.svg'
          }
        ]
      },
      {
        id: 'buryatia', name: 'Бурятия', nameTo: 'в Бурятию',
        scene: 'baikal', color: '#1F86FF', obstacle: 'ice', speed: 130, gap: 172,
        cards: [
          {
            title: 'Озеро Байкал',
            text: 'Байкал — самое глубокое озеро на планете: 1642 метра. В него впадает больше трёхсот рек, а вытекает только одна — Ангара.\n\nЗдесь живёт байкальская нерпа — тюлень, который больше нигде в мире не встречается. Восточный берег Байкала — это Бурятия.',
            image: 'img/cards/baikal.svg'
          },
          {
            title: 'Баргузинский заповедник',
            text: 'Это самый старый заповедник России. Его создали в 1917 году на берегу Байкала, чтобы спасти баргузинского соболя: тогда этих зверьков почти не осталось.\n\nСейчас соболей здесь снова много, а 11 января в честь этого события в России отмечают День заповедников.',
            image: 'img/cards/barguzin.svg'
          }
        ]
      }
    ]
  };

  function str(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim() : fallback;
  }

  function num(value, fallback, min, max) {
    var n = typeof value === 'number' && isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
  }

  /* Картинка открытки: относительный путь рядом с игрой или https-адрес CDN. */
  function imageUrl(value) {
    var s = str(value, '');
    if (!s) return '';
    if (/^https:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.indexOf('//') === 0) return '';
    return s;
  }

  function normalizeCard(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var title = str(raw.title, '');
    var text = str(raw.text, '');
    if (!title || !text) return null;
    return { title: title, text: text, image: imageUrl(raw.image) };
  }

  function normalizeRegion(raw, index) {
    if (!raw || typeof raw !== 'object') return null;
    var name = str(raw.name, '');
    if (!name) return null;
    var cards = (Array.isArray(raw.cards) ? raw.cards : []).map(normalizeCard).filter(Boolean);
    if (!cards.length) return null;
    return {
      id: str(raw.id, 'region-' + index),
      name: name,
      nameTo: str(raw.nameTo, ''),
      scene: SCENES.indexOf(raw.scene) !== -1 ? raw.scene : SCENES[index % SCENES.length],
      color: /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : COLORS[index % COLORS.length],
      obstacle: OBSTACLES.indexOf(raw.obstacle) !== -1 ? raw.obstacle : OBSTACLES[index % OBSTACLES.length],
      speed: num(raw.speed, 120, 70, 220),
      gap: num(raw.gap, 180, 140, 260),
      cards: cards
    };
  }

  /* Приводит сырой JSON к форме, с которой работает игра. null — если пользоваться нельзя. */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.regions)) return null;
    var regions = raw.regions.map(normalizeRegion).filter(Boolean);
    if (!regions.length) return null;
    var coin = raw.coin && typeof raw.coin === 'object' ? raw.coin : {};
    return {
      title: str(raw.title, DEFAULT_CONTENT.title),
      subtitle: str(raw.subtitle, DEFAULT_CONTENT.subtitle),
      pointsPerCard: Math.round(num(raw.pointsPerCard, 10, 1, 50)),
      coin: {
        chance: num(coin.chance, 0.35, 0, 1),
        value: Math.round(num(coin.value, 2, 1, 10))
      },
      regions: regions
    };
  }

  function load(callback) {
    var done = false;
    function finish(raw) {
      if (done) return;
      done = true;
      callback(normalize(raw) || normalize(DEFAULT_CONTENT));
    }
    setTimeout(function () { finish(null); }, LOAD_TIMEOUT_MS);
    if (!window.fetch) { finish(null); return; }
    fetch(CONTENT_URL, { cache: 'no-store' })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(finish, function () { finish(null); });
  }

  window.Content = { load: load, normalize: normalize, DEFAULT: DEFAULT_CONTENT };
})();
