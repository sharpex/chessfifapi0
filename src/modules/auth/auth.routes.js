import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import * as authController from './auth.controller.js';
import { signUpValidation, signInValidation, oauthValidation, forgotPasswordValidation, resetPasswordValidation } from './auth.validation.js';

const router = Router();

router.post('/signup', signUpValidation, validate, authController.signUp);
router.post('/signin', signInValidation, validate, authController.signIn);
router.post('/oauth/:provider', oauthValidation, validate, authController.oauthSignIn);
router.post('/forgot-password', forgotPasswordValidation, validate, authController.forgotPassword);
router.post('/reset-password', resetPasswordValidation, validate, authController.resetPassword);
router.get('/google-client-id', authController.googleClientId); // public — see controller
router.get('/me', authenticate, authController.getMe);

export default router;
