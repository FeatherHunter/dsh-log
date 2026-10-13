import type { PhoneAction } from './constants.js';
export declare function buildPhoneName(prefix: string, action: PhoneAction): string;
export type PhoneNameMap = Record<PhoneAction, string>;
export declare function buildPhoneNames(prefix: string): PhoneNameMap;
export declare function buildLogQueryPhoneName(prefix: string): string;
