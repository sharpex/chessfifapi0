import { Chess } from 'chess.js';

/** The server never trusts a client's claim about a move's legality or the game's
 *  outcome — every move is replayed from the match's stored FEN and validated fresh here
 *  before it's accepted, and the resulting checkmate/draw state is read back off this
 *  same engine rather than whatever the client's own UI thinks happened. */

export function loadGame(fen) {
  return new Chess(fen);
}

/** Returns the applied move (with .san, .to, .from, .captured, etc.) or null if illegal.
 *  Prefers the structured {from, to, promotion} form when available — chess.js's SAN
 *  string parser (game.move(sanString)) has to re-derive from/to/disambiguation/promotion
 *  from text, which is where a promotion move (e.g. "e8=Q#") is most likely to trip on a
 *  quirk in an older chess.js version and silently fail to parse; the object form is
 *  unambiguous and skips that step entirely, since it's exactly what completeMove() in the
 *  frontend already uses for a locally-made move. `san` is only a fallback for anything
 *  that genuinely doesn't have from/to (there's no such caller left in this codebase, but
 *  keeping it costs nothing and it was the only form early versions of this ever sent). */
export function tryMove(game, { from, to, san, promotion }) {
  if (from && to) return game.move({ from, to, promotion: promotion || 'q' }) || null;
  if (san) return game.move(san) || null;
  return null;
}

export function describeGameEnd(game) {
  if (game.in_checkmate()) {
    // The side left to move is the one with no escape — they're the one mated.
    return { isOver: true, reason: 'checkmate', matedColor: game.turn() };
  }
  if (game.in_stalemate()) return { isOver: true, reason: 'stalemate' };
  if (game.insufficient_material()) return { isOver: true, reason: 'insufficient_material' };
  if (game.in_threefold_repetition()) return { isOver: true, reason: 'threefold_repetition' };
  if (game.in_draw()) return { isOver: true, reason: 'fifty_move_rule' };
  return { isOver: false };
}
