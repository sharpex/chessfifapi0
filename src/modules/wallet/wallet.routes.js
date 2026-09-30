import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as walletController from './wallet.controller.js';

const router = Router();

router.get('/', authenticate, walletController.getMyWallet);

// Deposits: initialize starts a Paystack transaction, verify confirms it once the Inline
// popup reports success (the webhook below confirms it independently too — see
// wallet.service.js's confirmDeposit for how the two are reconciled).
router.post('/deposit/initialize', authenticate, walletController.initializeDeposit);
router.post('/deposit/verify', authenticate, walletController.verifyDeposit);

// Withdrawals: a single call debits the wallet and hands off to Paystack's Transfer API.
router.post('/withdraw/initialize', authenticate, walletController.initializeWithdrawal);
router.get('/banks', authenticate, walletController.getBanks);
router.get('/resolve-account', authenticate, walletController.resolveAccount);

// Paystack's own server-to-server callback — deliberately not behind `authenticate`,
// see wallet.controller.js's paystackWebhook for how it's verified instead.
router.post('/webhook/paystack', walletController.paystackWebhook);

export default router;
