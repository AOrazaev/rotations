import { createEventListController } from './event-list.js';
import { buildGameAnalysis } from './event-reducer.js';
import { createReportController } from './report-view.js';

export function createReviewController({
  documentObject = document,
  videoController
}) {
  const eventLogPanel = documentObject.querySelector('#eventLogPanel');
  const undoButton = documentObject.querySelector('#undoEvent');
  const eventListController = createEventListController({
    documentObject,
    videoController,
    readOnly: true
  });
  const reportController = createReportController({ documentObject, videoController });
  let game = null;

  undoButton.remove();

  function render() {
    eventLogPanel.classList.toggle('hidden', !game);
    if (!game) {
      eventListController.render(null);
      reportController.render(null, null);
      return;
    }
    const analysis = buildGameAnalysis(game);
    eventListController.render(game);
    reportController.render(game, analysis);
  }

  render();

  return {
    setGame(nextGame) {
      game = structuredClone(nextGame);
      render();
    },
    getGame: () => game ? structuredClone(game) : null,
    destroy() {}
  };
}
