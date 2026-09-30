import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as matchController from './match.controller.js';

const router = Router();

// /active and /history must be registered before /:id below, or Express would match
// "active"/"history" as an :id param instead of routing to these.
router.get('/active', authenticate, matchController.getActiveMatch);
router.get('/history', authenticate, matchController.getHistory);
router.get('/:id', authenticate, matchController.getMatch);
router.post('/:id/moves', authenticate, matchController.submitMove);
router.post('/:id/result', authenticate, matchController.reportResult);
router.get('/:id/messages', authenticate, matchController.getMessages);
router.post('/:id/messages', authenticate, matchController.sendMessage);

export default router;
