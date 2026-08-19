// A message asked for by name from ordinary TypeScript, which is what the
// lexical scan is for. Reporting this one as unused would be a warning about
// correct code, so it is the control for the message beside it that nothing
// asks for.
import { t } from 'virtual:volt-messages';

export const line = (amount: number): string => t('checkoutTotal', { amount });
