// The same application written against the dynamic-key export, which names
// every message and so links the catalogue whole. The control for
// `one-message.ts`.
import { t } from 'virtual:volt-messages';

export const line = (key: string, amount: number): string => t(key, { amount });
