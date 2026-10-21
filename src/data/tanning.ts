import type { ItemId } from './items';

/** What the tanner makes: one hide in, one leather out, for a fee in coins each. */
export const TANNING: { from: ItemId; to: ItemId; cost: number }[] = [{ from: 'wolf_pelt', to: 'leather', cost: 2 }];
