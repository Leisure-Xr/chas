(function () {
  'use strict';

  function hostAction(action, params) {
    window.location.href = 'https://linux.do/__lexiao_break/' + action + '?t=' + Date.now() + (params ? '&' + params : '');
  }

  var controller = window.LinuxDoGameUI.open({
    core: window.LinuxDoGameCore,
    recommended: __LEXIAO_RECOMMENDED_GAME__,
    reminderMode: __LEXIAO_REMINDER_MODE__,
    bestScores: __LEXIAO_BEST_SCORES__,
    onBestScore: function (game, value) {
      hostAction('score', 'game=' + encodeURIComponent(game) + '&value=' + encodeURIComponent(value));
    },
    onContinue: function () { hostAction('continue'); },
    onSnooze: function () { hostAction('snooze'); }
  });

  window.__lexiaoBreakCleanup = function () {
    controller.destroy();
    window.__lexiaoBreakCleanup = null;
  };
})();
