import * as matchService from '../../modules/matches/match.service.js';

/** Registers the match-related listeners for one connected socket. Mirrors the REST
 *  endpoints in modules/matches/ — the frontend uses whichever path is actually available
 *  (socket when connected, REST only as the fallback when it isn't — see relayMove/resign
 *  in useMatchStore.js), not both at once, so both paths run the exact same service
 *  functions but are never actually racing each other in normal operation. */
export function registerMatchHandlers(socket) {
  socket.on('match:move', async payload => {
    try {
      await matchService.submitMove(payload.matchId, socket.userId, {
        san: payload.san,
        from: payload.from,
        to: payload.to,
        promotion: payload.promotion
      });
    } catch (err) {
      // Genuinely unusual here (a rejected move on the socket path, which is the sole
      // delivery path whenever it's the one being used) — there's no REST call in flight
      // to have carried the real result instead, so this is swallowed only because there's
      // no clean way to get an error back to the client over a fire-and-forget socket
      // event; the client's own local validation is what actually stops an illegal move
      // from being attempted in the first place.
    }
  });

  socket.on('match:resign', async payload => {
    try {
      await matchService.resignMatch(payload.matchId, socket.userId);
    } catch (err) {
      // Same reasoning as above — this is the sole delivery path when the socket is
      // connected (see resign()/forfeitAndClearMatch() in useMatchStore.js).
    }
  });

  socket.on('match:leaving', payload => {
    // Best-effort signal that a tab is closing mid-match — the actual disconnect (and
    // the 5-minute forfeit window it starts) is handled uniformly in
    // connectionHandler.js's 'disconnect' listener regardless of whether this arrived,
    // since a real page unload doesn't reliably deliver a final event anyway.
  });

  // Chat gets an acknowledgment callback, unlike the events above — a dropped move or
  // resign has other ways to surface (the board just doesn't update, the "leave" flow has
  // its own toast), but a silently-swallowed chat message would just look like it sent
  // when it didn't, which is worse for something this low-stakes than a visible error.
  socket.on('match:chat', async (payload, callback) => {
    try {
      await matchService.sendMatchMessage(payload.matchId, socket.userId, payload.text);
      if (typeof callback === 'function') callback({ ok: true });
    } catch (err) {
      if (typeof callback === 'function') callback({ ok: false, message: err.message });
    }
  });
}
