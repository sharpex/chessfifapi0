import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import * as mpesaController from './mpesa.controller.js';

const router = Router();

router.get('/config', mpesaController.getConfig); // public — see controller
router.post('/deposit/initialize', authenticate, mpesaController.initiateDeposit);
router.get('/deposit/:reference/status', authenticate, mpesaController.getDepositStatus);
router.post('/withdraw/initialize', authenticate, mpesaController.initiateWithdrawal);

export default router;
