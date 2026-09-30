import { Router } from 'express';
import { authenticateOptional } from '../../middleware/authenticate.js';
import * as lobbyController from './lobby.controller.js';

const router = Router();

router.get('/players', authenticateOptional, lobbyController.getPlayers);
router.get('/challenges', authenticateOptional, lobbyController.getOpenChallenges);

export default router;
