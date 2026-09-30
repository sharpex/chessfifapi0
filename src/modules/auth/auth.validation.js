import { body } from 'express-validator';

export const signUpValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 80 }),
  body('email').optional({ values: 'falsy' }).isEmail().withMessage('Invalid email'),
  body('password').optional({ values: 'falsy' }).isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];

export const signInValidation = [
  body('email').isEmail().withMessage('Invalid email'),
  body('password').notEmpty().withMessage('Password is required')
];

export const oauthValidation = [
  body('token').notEmpty().withMessage('Missing OAuth token')
];

export const forgotPasswordValidation = [
  body('email').isEmail().withMessage('Invalid email')
];

export const resetPasswordValidation = [
  body('token').notEmpty().withMessage('Missing reset token'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
];
