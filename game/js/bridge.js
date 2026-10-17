/* Канал «страница → приложение» по контракту хакатона: обычный window.postMessage.
   Приложение само подписывается на сообщения; в браузере они просто никуда не уходят. */
(function () {
  'use strict';

  var completedSent = false;

  function send(message) {
    try {
      window.postMessage(message, '*');
    } catch (e) { /* в браузере без приложения отправлять некому */ }
  }

  window.Bridge = {
    close: function () { send({ type: 'CLOSE_EVENT' }); },
    finish: function () { send({ type: 'FINISH_EVENT' }); },
    /* Засчитывает прогресс курса. По контракту отправляется один раз за открытие. */
    completed: function () {
      if (completedSent) return;
      completedSent = true;
      send({ type: 'COMPLETED_EVENT' });
    },
    vibrate: function () { send({ type: 'VIBRATION_EVENT' }); },
    share: function (text, image) {
      var message = { type: 'SHARING_EVENT' };
      if (text) message.text = text;
      if (image) message.image = image;
      send(message);
    }
  };
})();
