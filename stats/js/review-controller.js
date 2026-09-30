import { createEventListController } from './event-list.js';
import { buildGameAnalysis } from './event-reducer.js';
import { createReportController } from './report-view.js';

export function createReviewController({
  documentObject = document,
  videoController
}) {
  const eventLogPanel = documentObject.querySelector('#eventLogPanel');
  const eventTimelineInstruction = documentObject.querySelector('#eventTimelineInstruction');
  const undoButton = documentObject.querySelector('#undoEvent');
  const navigation = documentObject.querySelector('#reviewNavigation');
  const navigationButtons = [...navigation.querySelectorAll('[data-review-section]')];
  const reportCard = documentObject.querySelector('#reportCard');
  const teamSection = documentObject.querySelector('#teamReportSection');
  const playerSection = documentObject.querySelector('#playerReportSection');
  const feedbackSection = documentObject.querySelector('#feedbackReportSection');
  const lineupSection = documentObject.querySelector('#lineupReportSection');
  const progressionSection = documentObject.querySelector('#scoreProgressionSection');
  const sourceSection = documentObject.querySelector('#reportSourceSection');
  const reviewScore = documentObject.querySelector('#reviewModeScore');
  const eventListController = createEventListController({
    documentObject,
    videoController,
    readOnly: true,
    initialEarliestFirst: true,
    followPlayback: true
  });
  const reportController = createReportController({
    documentObject,
    videoController,
    previewSeconds: 3
  });
  let game = null;
  let activeSection = 'team';

  undoButton.remove();
  eventTimelineInstruction.textContent = 'Play recorded events.';
  for (const [panel, tabId] of [
    [teamSection, 'reviewTabTeam'],
    [playerSection, 'reviewTabPlayers'],
    [lineupSection, 'reviewTabLineups'],
    [feedbackSection, 'reviewTabFeedback']
  ]) {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabId);
  }

  function setActiveSection(section, { moveFocus = false } = {}) {
    if (!navigationButtons.some(button => button.dataset.reviewSection === section)) return;
    activeSection = section;
    for (const button of navigationButtons) {
      const active = button.dataset.reviewSection === section;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && moveFocus) button.focus();
    }

    eventLogPanel.classList.toggle('hidden', !game);
    reportCard.classList.toggle('hidden', !game);
    teamSection.classList.toggle('hidden', section !== 'team');
    playerSection.classList.toggle('hidden', section !== 'players');
    feedbackSection.classList.toggle('hidden', section !== 'feedback');
    lineupSection.classList.toggle('hidden', section !== 'lineups');
    progressionSection.classList.toggle('hidden', section !== 'team');
    sourceSection.classList.toggle('hidden', !['team', 'players', 'lineups'].includes(section));
  }

  function handleNavigationClick(event) {
    const button = event.target.closest('[data-review-section]');
    if (button) setActiveSection(button.dataset.reviewSection);
  }

  function handleNavigationKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const currentIndex = navigationButtons.findIndex(button => button.dataset.reviewSection === activeSection);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = navigationButtons.length - 1;
    else {
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      nextIndex = (currentIndex + offset + navigationButtons.length) % navigationButtons.length;
    }
    setActiveSection(navigationButtons[nextIndex].dataset.reviewSection, { moveFocus: true });
    event.preventDefault();
  }

  navigation.addEventListener('click', handleNavigationClick);
  navigation.addEventListener('keydown', handleNavigationKeydown);

  function render() {
    navigation.classList.toggle('hidden', !game);
    if (!game) {
      eventListController.render(null);
      reportController.render(null, null);
      setActiveSection(activeSection);
      return;
    }
    const analysis = buildGameAnalysis(game);
    reviewScore.textContent = `${analysis.report.score.team}–${analysis.report.score.opponent}`;
    eventListController.render(game);
    reportController.render(game, analysis);
    setActiveSection(activeSection);
  }

  render();

  return {
    setGame(nextGame) {
      game = structuredClone(nextGame);
      render();
    },
    getGame: () => game ? structuredClone(game) : null,
    destroy() {
      navigation.removeEventListener('click', handleNavigationClick);
      navigation.removeEventListener('keydown', handleNavigationKeydown);
      eventListController.destroy();
    }
  };
}
