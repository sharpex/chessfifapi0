import * as challengeService from './challenge.service.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/** Matches frontend: challengeApi.create(opponentId, stake) -> POST /challenges.
 *  opponentId is null for an open challenge anyone can accept. */
export const createChallenge = asyncHandler(async (req, res) => {
  const { opponentId, stake } = req.body;
  const result = await challengeService.createChallenge(req.user.id, opponentId || null, Number(stake));
  res.status(201).json(result);
});

export const getChallengeStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await challengeService.getChallengeStatus(id);
  res.json(result);
});

/** Matches frontend: challengeApi.getMyChallenges() -> GET /challenges/mine. Must stay
 *  registered before GET /:id in challenge.routes.js, or Express matches "mine" as an :id
 *  instead of this route. */
export const getMyChallenges = asyncHandler(async (req, res) => {
  const result = await challengeService.getMyChallenges(req.user.id);
  res.json(result);
});

export const acceptChallenge = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await challengeService.acceptChallenge(id, req.user.id);
  res.json(result);
});

export const declineChallenge = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await challengeService.declineChallenge(id, req.user.id);
  res.json(result);
});

export const updateChallenge = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { stake } = req.body;
  const result = await challengeService.updateChallengeStake(id, req.user.id, Number(stake));
  res.json(result);
});

export const deleteChallenge = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const result = await challengeService.cancelChallenge(id, req.user.id);
  res.json(result);
});
