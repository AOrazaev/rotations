import { createEventListController, describeEvent } from './event-list.js';
import { buildGameAnalysis } from './event-reducer.js';
import { createReportController } from './report-view.js';
import { commentMentionsPlayer } from './comment-mentions.js';
import { getShotDetailBadges } from './shot-details.js';
import { formatVideoTime } from './youtube-player.js';

export function createReviewController({
  documentObject = document,
  videoController,
  initialTimelineFilters = null,
  feedbackPlayerId = null,
  onPlayerFeedbackStateChanged = () => {},
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
  const playerFrame = documentObject.querySelector('#playerFrame');
  const playFocusedFeedbackVideo = documentObject.querySelector('#playFocusedFeedbackVideo');
  const videoStatus = documentObject.querySelector('#videoStatus');
  const feedbackPanel = documentObject.querySelector('#sharedFeedbackPanel');
  const feedbackMomentCard = documentObject.querySelector('#sharedFeedbackMomentCard');
  const previousFeedbackMoment = documentObject.querySelector('#previousSharedFeedbackMoment');
  const nextFeedbackMoment = documentObject.querySelector('#nextSharedFeedbackMoment');
  const feedbackMomentPosition = documentObject.querySelector('#sharedFeedbackMomentPosition');
  const showFeedbackPlayerShots = documentObject.querySelector('#showSharedFeedbackPlayerShots');
  const playFeedbackLeadIn = documentObject.querySelector('#playSharedFeedbackLeadIn');
  const feedbackReasonBadge = documentObject.querySelector('#sharedFeedbackReason');
  const feedbackEventTime = documentObject.querySelector('#sharedFeedbackEventTime');
  const feedbackEventDescription = documentObject.querySelector('#sharedFeedbackEventDescription');
  const feedbackEventDetails = documentObject.querySelector('#sharedFeedbackEventDetails');
  const feedbackComment = documentObject.querySelector('#sharedFeedbackComment');
  let game = null;
  let analysis = null;
  let playbackSeconds = 0;
  let baseFeedbackEvents = [];
  let feedbackEvents = [];
  let feedbackMomentIndex = 0;
  let feedbackActive = false;
  let includePlayerShots = false;
  let videoReady = videoController.isReady();
  let initialFeedbackPositioned = false;
  let feedbackPausePending = false;
  let feedbackFullscreenTarget = null;
  let feedbackFullscreenActive = false;
  let activeSection = feedbackPlayerId ? 'feedback' : 'team';

  function feedbackReason(event, player, filters) {
    if ([event.playerId, event.playerInId, event.playerOutId].includes(player.id)) {
      return 'direct';
    }
    if (commentMentionsPlayer(event.coachComment, player)) return 'mention';
    if (filters.teamMention) return 'team';
    return null;
  }

  function renderFocusedFeedbackMoment() {
    const hasMoments = feedbackEvents.length > 0;
    feedbackPanel.classList.toggle('hidden', !feedbackActive);
    feedbackMomentCard.classList.toggle('hidden', !hasMoments);
    previousFeedbackMoment.disabled = !hasMoments || !videoReady || feedbackMomentIndex <= 0;
    nextFeedbackMoment.disabled = !hasMoments || !videoReady || feedbackMomentIndex >= feedbackEvents.length - 1;
    playFeedbackLeadIn.disabled = !hasMoments || !videoReady;
    feedbackMomentPosition.textContent = hasMoments
      ? `${feedbackMomentIndex + 1} of ${feedbackEvents.length}`
      : 'No feedback moments';
    if (!hasMoments) return;

    const event = feedbackEvents[feedbackMomentIndex];
    const player = game.players.find(item => item.id === feedbackPlayerId);
    const playersById = Object.fromEntries(game.players.map(item => [item.id, item]));
    const reason = feedbackReason(event, player, eventListController.getFilters());
    const reasonLabels = {
      direct: 'Your play',
      mention: `Mentioned @${player.number}`,
      team: 'Team feedback'
    };
    feedbackReasonBadge.dataset.feedbackReason = reason;
    feedbackReasonBadge.textContent = reasonLabels[reason] || 'Feedback';
    feedbackEventTime.textContent = formatVideoTime(event.videoSeconds);
    feedbackEventDescription.textContent = describeEvent(event, playersById);
    const detailLabels = getShotDetailBadges(event).map(badge => badge.label);
    feedbackEventDetails.textContent = detailLabels.join(' · ');
    feedbackEventDetails.classList.toggle('hidden', !detailLabels.length);
    feedbackComment.textContent = String(event.coachComment || '').trim();
    feedbackComment.classList.toggle('hidden', !feedbackComment.textContent);
  }

  function setFocusedVideoPlayVisible(visible) {
    const mobile = documentObject.defaultView.matchMedia(
      '(max-width: 760px), (max-height: 760px)'
    ).matches;
    playFocusedFeedbackVideo.classList.toggle(
      'hidden',
      !visible || !mobile || !feedbackPlayerId
    );
  }

  function positionInitialFeedbackMoment() {
    if (initialFeedbackPositioned || !videoReady || !feedbackEvents.length) return;
    initialFeedbackPositioned = true;
    feedbackMomentIndex = 0;
    const event = feedbackEvents[0];
    renderFocusedFeedbackMoment();
    feedbackPausePending = true;
    videoController.seekToPaused(Math.max(0, event.videoSeconds - 5));
    setFocusedVideoPlayVisible(true);
  }

  function handleVisibleEventsChanged(events, filters) {
    const player = game?.players.find(item => item.id === feedbackPlayerId);
    const active = Boolean(
      player
      && filters.players.length === 1
      && filters.players[0] === feedbackPlayerId
    );
    const currentEvent = feedbackEvents[feedbackMomentIndex];
    feedbackActive = active;
    baseFeedbackEvents = active ? events : [];
    const mergedEvents = includePlayerShots && player
      ? [
        ...baseFeedbackEvents,
        ...game.events.filter(event =>
          event.type === 'shot'
          && event.side === 'team'
          && event.playerId === player.id
        )
      ]
      : baseFeedbackEvents;
    feedbackEvents = [...new Map(mergedEvents.map(event => [event.id, event])).values()]
      .sort((a, b) => a.videoSeconds - b.videoSeconds || a.sequence - b.sequence);
    const currentIndex = currentEvent
      ? feedbackEvents.findIndex(event => event.id === currentEvent.id)
      : -1;
    if (currentIndex >= 0) {
      feedbackMomentIndex = currentIndex;
    } else if (currentEvent && feedbackEvents.length) {
      feedbackMomentIndex = feedbackEvents.reduce((nearestIndex, event, index) =>
        Math.abs(event.videoSeconds - currentEvent.videoSeconds)
          < Math.abs(feedbackEvents[nearestIndex].videoSeconds - currentEvent.videoSeconds)
          ? index
          : nearestIndex, 0);
    } else {
      feedbackMomentIndex = Math.min(
        feedbackMomentIndex,
        Math.max(0, feedbackEvents.length - 1)
      );
    }
    const reasons = active
      ? feedbackEvents.map(event => feedbackReason(event, player, filters))
      : [];
    onPlayerFeedbackStateChanged({
      active,
      player: player ? structuredClone(player) : null,
      total: feedbackEvents.length,
      direct: reasons.filter(reason => reason === 'direct').length,
      mentions: reasons.filter(reason => reason === 'mention').length,
      team: reasons.filter(reason => reason === 'team').length
    });
    if (!active && activeSection === 'feedback') activeSection = 'team';
    renderFocusedFeedbackMoment();
    positionInitialFeedbackMoment();
  }

  function selectFeedbackEvent(eventId) {
    const index = feedbackEvents.findIndex(event => event.id === eventId);
    if (index < 0) return;
    feedbackMomentIndex = index;
    renderFocusedFeedbackMoment();
  }

  const eventListController = createEventListController({
    documentObject,
    videoController,
    readOnly: true,
    initialEarliestFirst: true,
    followPlayback: true,
    initialFilters: initialTimelineFilters,
    feedbackPlayerId,
    onVisibleEventsChanged: handleVisibleEventsChanged,
    onEventPlayed: event => selectFeedbackEvent(event.id),
    onFiltersChanged: onTimelineFiltersChanged
  });
  const reportController = createReportController({
    documentObject,
    videoController,
    previewSeconds: 3,
    playerReview: true,
    initialFeedbackPlayerId: feedbackPlayerId
  });

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
    const videoPlaying = videoController.isPlaying();
    if (feedbackPausePending) {
      if (!videoPlaying) feedbackPausePending = false;
    } else if (feedbackEvents.length && videoPlaying) {
      const targetSeconds = seconds + 3;
      let nearestIndex = 0;
      for (let index = 1; index < feedbackEvents.length; index += 1) {
        if (
          Math.abs(feedbackEvents[index].videoSeconds - targetSeconds)
          < Math.abs(feedbackEvents[nearestIndex].videoSeconds - targetSeconds)
        ) {
          nearestIndex = index;
        }
      }
      feedbackMomentIndex = nearestIndex;
      renderFocusedFeedbackMoment();
    }
    updatePlaybackScore();
  });

  function moveFeedbackMoment(offset) {
    if (!feedbackEvents.length || !videoReady) return;
    const nextIndex = Math.min(
      feedbackEvents.length - 1,
      Math.max(0, feedbackMomentIndex + offset)
    );
    if (nextIndex === feedbackMomentIndex && offset !== 0) return;
    feedbackMomentIndex = nextIndex;
    const event = feedbackEvents[nextIndex];
    renderFocusedFeedbackMoment();
    feedbackPausePending = true;
    videoController.seekToPaused(Math.max(0, event.videoSeconds - 5));
    setFocusedVideoPlayVisible(true);
    eventListController.revealEvent(event.id);
  }

  function playFeedbackMoment(previewSeconds) {
    if (!feedbackEvents.length || !videoReady) return;
    setFocusedVideoPlayVisible(false);
    if (documentObject.defaultView.matchMedia(
      '(max-width: 760px), (max-height: 760px)'
    ).matches) {
      const fullscreenTarget = playerFrame.querySelector('iframe') || playerFrame;
      const requestFullscreen = fullscreenTarget.requestFullscreen
        || fullscreenTarget.webkitRequestFullscreen;
      if (!requestFullscreen) {
        videoStatus.textContent = 'Video is playing. Full screen is unavailable in this browser.';
      } else {
        feedbackFullscreenTarget = fullscreenTarget;
        try {
          const fullscreenRequest = requestFullscreen.call(fullscreenTarget);
          if (fullscreenRequest?.then) {
            fullscreenRequest
              .then(() => {
                feedbackFullscreenActive = true;
              })
              .catch(() => {
                feedbackFullscreenTarget = null;
                videoStatus.textContent = 'Video is playing. Full screen could not be opened.';
              });
          } else {
            feedbackFullscreenActive = true;
          }
        } catch {
          feedbackFullscreenTarget = null;
          videoStatus.textContent = 'Video is playing. Full screen could not be opened.';
        }
      }
    }
    const event = feedbackEvents[feedbackMomentIndex];
    videoController.seekTo(Math.max(0, event.videoSeconds - previewSeconds));
    videoController.play();
  }

  function handleFocusedVideoPlay() {
    if (!videoReady) return;
    setFocusedVideoPlayVisible(false);
    videoController.play();
  }

  function handleFeedbackFullscreenChange() {
    if (!feedbackFullscreenActive) return;
    const fullscreenElement = documentObject.fullscreenElement
      || documentObject.webkitFullscreenElement;
    if (fullscreenElement === feedbackFullscreenTarget) return;
    feedbackFullscreenActive = false;
    feedbackFullscreenTarget = null;
    if (videoReady) {
      videoController.pause();
      setFocusedVideoPlayVisible(true);
    }
  }

  const handlePreviousFeedbackMoment = () => moveFeedbackMoment(-1);
  const handleNextFeedbackMoment = () => moveFeedbackMoment(1);
  const handlePlayFeedbackLeadIn = () => playFeedbackMoment(5);
  const handleShowFeedbackPlayerShots = () => {
    includePlayerShots = showFeedbackPlayerShots.checked;
    handleVisibleEventsChanged(baseFeedbackEvents, eventListController.getFilters());
  };
  previousFeedbackMoment.addEventListener('click', handlePreviousFeedbackMoment);
  nextFeedbackMoment.addEventListener('click', handleNextFeedbackMoment);
  playFeedbackLeadIn.addEventListener('click', handlePlayFeedbackLeadIn);
  showFeedbackPlayerShots.addEventListener('change', handleShowFeedbackPlayerShots);
  playFocusedFeedbackVideo.addEventListener('click', handleFocusedVideoPlay);
  documentObject.addEventListener('fullscreenchange', handleFeedbackFullscreenChange);
  documentObject.addEventListener('webkitfullscreenchange', handleFeedbackFullscreenChange);
  const unsubscribeReady = videoController.subscribeReady(ready => {
    videoReady = ready;
    if (!ready) {
      initialFeedbackPositioned = false;
      setFocusedVideoPlayVisible(false);
    }
    renderFocusedFeedbackMoment();
    positionInitialFeedbackMoment();
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
      includePlayerShots = false;
      showFeedbackPlayerShots.checked = false;
      initialFeedbackPositioned = false;
      render();
    },
    getGame: () => game ? structuredClone(game) : null,
    getTimelineFilters: () => eventListController.getFilters(),
    destroy() {
      navigation.removeEventListener('click', handleNavigationClick);
      navigation.removeEventListener('keydown', handleNavigationKeydown);
      previousFeedbackMoment.removeEventListener('click', handlePreviousFeedbackMoment);
      nextFeedbackMoment.removeEventListener('click', handleNextFeedbackMoment);
      playFeedbackLeadIn.removeEventListener('click', handlePlayFeedbackLeadIn);
      showFeedbackPlayerShots.removeEventListener('change', handleShowFeedbackPlayerShots);
      playFocusedFeedbackVideo.removeEventListener('click', handleFocusedVideoPlay);
      documentObject.removeEventListener('fullscreenchange', handleFeedbackFullscreenChange);
      documentObject.removeEventListener('webkitfullscreenchange', handleFeedbackFullscreenChange);
      unsubscribeReady();
      unsubscribeTime();
      eventListController.destroy();
    }
  };
}
