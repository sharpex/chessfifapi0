import * as lobbyService from './lobby.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/** Matches frontend: lobbyApi.getPlayers() -> GET /lobby/players. Works for guests too
 *  (authenticateOptional) — only logged-in users get themselves excluded from the list. */
export const getPlayers = asyncHandler(async (req, res) => {
  const players = await lobbyService.getOnlinePlayers(req.user?.id ?? null);
  res.json(players);
});

/** Matches frontend: lobbyApi.getOpenChallenges() -> GET /lobby/challenges. Also works for
 *  guests — browsing what's available to accept doesn't need an account, only accepting
 *  one does (that's gated at the point of accepting, same pattern as everywhere else). */
export const getOpenChallenges = asyncHandler(async (req, res) => {
  const challenges = await lobbyService.getOpenChallenges(req.user?.id ?? null);
  res.json(challenges);
});
