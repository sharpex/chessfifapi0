import { Router } from 'express';
import * as legalController from './legal.controller.js';

const router = Router();

// Both public — see legal.controller.js. Static content, so no asyncHandler wrapper
// needed here the way every other route in this app has (nothing here can reject).
router.get('/terms', legalController.getTerms);
router.get('/privacy', legalController.getPrivacyPolicy);

export default router;
