// One message out of a catalogue of four, imported the way an application
// imports one. What it must not reach is the other three.
import { checkoutTotal } from 'virtual:volt-messages';

export const line = (amount: number): string => checkoutTotal({ amount });
