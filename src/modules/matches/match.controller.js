import * as matchService from './match.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

export const submitMove = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { san, from, to, promotion, fen } = req.body; // fen is accepted but informational only — see match.service.js
  const result = await matchService.submitMove(id, req.user.id, { san, from, to, promotion });
  res.json(result);
});

/** Matches frontend: matchApi.reportResult(matchId, result) -> POST /matches/:id/result */
export const reportResult = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { result } = req.body;
  const outcome = await matchService.reportResult(id, req.user.id, result);
  res.json(outcome);
});

/** Matches frontend: matchApi.getActiveMatch() -> GET /matches/active. Must stay
 *  registered before GET /:id in match.routes.js, or Express matches "active" as an :id
 *  instead of this route. */
export const getActiveMatch = asyncHandler(async (req, res) => {
  const match = await matchService.getActiveMatchForUser(req.user.id);
  res.json(match); // null when there's nothing to resume — not a 404, see the service fn
});

/** Matches frontend: matchApi.getHistory() -> GET /matches/history. Same registration-order
 *  requirement as /active above — must come before GET /:id or Express would try to treat
 *  "history" as a match id. */
export const getHistory = asyncHandler(async (req, res) => {
  const history = await matchService.getMatchHistoryForUser(req.user.id);
  res.json(history);
});

export const getMatch = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const match = await matchService.getMatch(id, req.user.id);
  res.json(match);
});

/** Matches frontend: chatApi.getMessages(matchId) -> GET /matches/:id/messages. */
export const getMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const messages = await matchService.getMatchMessages(id, req.user.id);
  res.json(messages);
});

/** Matches frontend: chatApi.sendMessage(matchId, text) -> POST /matches/:id/messages.
 *  Fallback send path for when there's no live socket — see sendChatMessage in
 *  useMatchStore.js. */
export const sendMessage = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { text } = req.body;
  const message = await matchService.sendMatchMessage(id, req.user.id, text);
  res.json(message);
});
