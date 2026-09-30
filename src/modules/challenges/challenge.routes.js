import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import * as challengeController from './challenge.controller.js';
import { createChallengeValidation, updateChallengeValidation } from './challenge.validation.js';

const router = Router();

router.post('/', authenticate, createChallengeValidation, validate, challengeController.createChallenge);
// /mine must be registered before the /:id routes below, or Express would match "mine"
// as an :id param instead of routing here.
router.get('/mine', authenticate, challengeController.getMyChallenges);
router.get('/:id', authenticate, challengeController.getChallengeStatus);
router.post('/:id/accept', authenticate, challengeController.acceptChallenge);
router.post('/:id/decline', authenticate, challengeController.declineChallenge);
router.patch('/:id', authenticate, updateChallengeValidation, validate, challengeController.updateChallenge);
router.delete('/:id', authenticate, challengeController.deleteChallenge);

export default router;
