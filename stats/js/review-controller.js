import { createEventListController } from './event-list.js';
import { buildGameAnalysis } from './event-reducer.js';
import { createReportController } from './report-view.js';

export function createReviewController({
  documentObject = document,
  videoController,
  initialTimelineFilters = null,
  onTimelineFiltersChanged = () => {}
}) {
  const eventLogPanel = documentObject.querySelector('#eventLogPanel');
  const eventTimelineInstruction = documentObject.querySelector('#eventTimelineInstruction');
  const undoButton = documentObject.querySelector('#undoEvent');
  const navigation = documentObject.querySelector('#reviewNavigation');
  const navigationButtons = [...navigation.querySelectorAll('[data-review-section]')];
  const reportCard = documentObject.querySelector('#reportCard');
  const teamSection = documentObject.querySelector('#teamReportSection');
  const playerSection = documentObject.querySelector('#playerReportSection');
  const shotSection = documentObject.querySelector('#shotReportSection');
  const feedbackSection = documentObject.querySelector('#feedbackReportSection');
  const lineupSection = documentObject.querySelector('#lineupReportSection');
  const progressionSection = documentObject.querySelector('#scoreProgressionSection');
  const sourceSection = documentObject.querySelector('#reportSourceSection');
  const reviewScoreBlock = documentObject.querySelector('#reviewVideoScore');
  const reviewScore = documentObject.querySelector('#reviewModeScore');
  const reviewScoreOpponent = documentObject.querySelector('#reviewScoreOpponent');
  const eventListController = createEventListController({
    documentObject,
    videoController,
    readOnly: true,
    initialEarliestFirst: true,
    followPlayback: true,
    initialFilters: initialTimelineFilters,
    onFiltersChanged: onTimelineFiltersChanged
  });
  const reportController = createReportController({
    documentObject,
    videoController,
    previewSeconds: 3,
    playerReview: true
  });
  let game = null;
  let analysis = null;
  let playbackSeconds = 0;
  let activeSection = 'team';

  undoButton.remove();
  eventTimelineInstruction.textContent = 'Play recorded events.';
  for (const [panel, tabId] of [
    [teamSection, 'reviewTabTeam'],
    [playerSection, 'reviewTabPlayers'],
    [shotSection, 'reviewTabShots'],
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
    shotSection.classList.toggle('hidden', section !== 'shots');
    feedbackSection.classList.toggle('hidden', section !== 'feedback');
    lineupSection.classList.toggle('hidden', section !== 'lineups');
    progressionSection.classList.toggle('hidden', section !== 'team');
    sourceSection.classList.toggle('hidden', !['team', 'players', 'shots', 'lineups'].includes(section));
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

  function updatePlaybackScore() {
    let team = 0;
    let opponent = 0;
    for (const point of analysis?.scoreProgression || []) {
      if (point.videoSeconds > playbackSeconds) break;
      team = point.team;
      opponent = point.opponent;
    }
    const score = `${team}–${opponent}`;
    const opponentName = game?.opponentName?.trim() || 'Opponent';
    if (reviewScore.textContent !== score) reviewScore.textContent = score;
    if (reviewScoreOpponent.textContent !== opponentName) reviewScoreOpponent.textContent = opponentName;
    reviewScoreBlock.setAttribute(
      'aria-label',
      `Current score: Our team ${team}, ${opponentName} ${opponent}`
    );
  }

  const unsubscribeTime = videoController.subscribeTime(seconds => {
    playbackSeconds = seconds;
    updatePlaybackScore();
  });

  function render() {
    navigation.classList.toggle('hidden', !game);
    if (!game) {
      analysis = null;
      updatePlaybackScore();
      eventListController.render(null);
      reportController.render(null, null);
      setActiveSection(activeSection);
      return;
    }
    analysis = buildGameAnalysis(game);
    updatePlaybackScore();
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
    getTimelineFilters: () => eventListController.getFilters(),
    destroy() {
      navigation.removeEventListener('click', handleNavigationClick);
      navigation.removeEventListener('keydown', handleNavigationKeydown);
      unsubscribeTime();
      eventListController.destroy();
    }
  };
}
