export const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** How long a player has to make each move in a real (wagered) match before forfeiting —
 *  see moveTimeoutTracker.js. Exists so accepting a challenge and then just sitting on the
 *  position (connection perfectly fine, simply not moving) can't strand the opponent's
 *  escrowed stake indefinitely the way it could before this existed; the existing
 *  connection-loss forfeit (connectionTimeoutTracker.js) only ever catches an actual drop,
 *  not a player who stays connected and idle. Kept in one place since the frontend mirrors
 *  this value for its own (informational only) countdown display — see MOVE_TIME_LIMIT_MS
 *  in useMatchStore.js. */
export const MOVE_TIME_LIMIT_MS = Number(process.env.MOVE_TIME_LIMIT_MS || 30 * 1000);

