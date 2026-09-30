import { body } from 'express-validator';

export const createChallengeValidation = [
  body('stake').isFloat({ min: 100 }).withMessage('Stake must be at least KSh 100'),
  body('opponentId').optional({ values: 'falsy' }).isUUID()
];

export const updateChallengeValidation = [
  body('stake').isFloat({ min: 100 }).withMessage('Stake must be at least KSh 100')
];
