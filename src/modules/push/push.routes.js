import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as pushController from './push.controller.js';

const router = Router();

router.get('/vapid-public-key', pushController.vapidPublicKey); // public — see controller
router.post('/subscribe', authenticate, pushController.subscribe);
router.post('/unsubscribe', authenticate, pushController.unsubscribe);

export default router;
