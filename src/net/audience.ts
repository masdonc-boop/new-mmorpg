import type { GameEvent, GameWorld, PlayerId } from '../sim/world';

/**
 * Who should receive each simulation event (docs/MULTIPLAYER.md 3A.1 and 3A.5). The local game shows
 * every event to its one player; a server uses this to route events:
 *
 * - `self`: only the player whose turn produced it (their messages, bag, bank, dialogue,
 *   interfaces, personal house and allotments, and effects that don't say whose they are).
 * - `nearby`: players who can see where it happened. These events name the entities involved,
 *   so other players' screens can show them on the right character or creature.
 * - `zone`: everyone in the zone (shared world changes such as a node running out or a fire lit).
 *
 * The table is exhaustive over `GameEvent`, so a new event type must be classified to compile.
 */
export type AudienceKind = 'self' | 'nearby' | 'zone';

export const EVENT_AUDIENCE: Record<GameEvent['type'], AudienceKind> = {
  damage: 'nearby',
  attack: 'nearby',
  projectile: 'nearby',
  death: 'nearby',
  respawn: 'nearby',
  gather: 'nearby',
  nodeDepleted: 'zone',
  nodeRespawned: 'zone',
  fireLit: 'zone',
  // Visible effects that don't name whose they are: only their player (others see snapshots).
  heal: 'self',
  pickpocket: 'self',
  chest: 'self',
  stunned: 'self',
  bury: 'self',
  quench: 'self',
  obstacle: 'self',
  equipment: 'self',
  xp: 'self',
  levelUp: 'self',
  loot: 'self',
  message: 'self',
  dialogue: 'self',
  quest: 'self',
  checkpoint: 'self',
  region: 'self',
  inventoryFull: 'self',
  bankOpen: 'self',
  bankClose: 'self',
  bank: 'self',
  bankFull: 'self',
  productionOpen: 'self',
  productionClose: 'self',
  craft: 'self',
  exchangeOpen: 'self',
  exchangeClose: 'self',
  exchangeResult: 'self',
  exchange: 'self',
  hotspotOpen: 'self',
  house: 'self',
  patch: 'self',
  passage: 'self',
  prayer: 'self',
  toolbelt: 'self',
  drop: 'self',
  shopOpen: 'self',
  tannerOpen: 'self',
  tannerClose: 'self',
  shopClose: 'self',
  shop: 'self',
  // Trade events are addressed to each of the two players (`emitFor`).
  tradeRequest: 'self',
  trade: 'self',
};

export type Audience = { kind: 'self'; player: PlayerId } | { kind: 'nearby'; x: number; z: number } | { kind: 'zone' };

export interface RoutedEvent {
  event: GameEvent;
  audience: Audience;
}

/** The entity an event happens at, for `nearby` routing. */
function anchorOf(e: GameEvent): number | null {
  switch (e.type) {
    case 'damage':
      return e.target;
    case 'attack':
    case 'projectile':
      return e.source;
    case 'death':
    case 'respawn':
      return e.id;
    case 'gather':
      return e.node;
    default:
      return null;
  }
}

/**
 * Gives each event its audience. Each event comes with the player whose turn produced it (from
 * `drainEventsWithActors`); a plain list is treated as the local player's. Nearby events are placed
 * at the entity they name, or at that player.
 */
export function routeEvents(world: GameWorld, events: GameEvent[] | { event: GameEvent; actor: PlayerId }[]): RoutedEvent[] {
  return events.map((x) => {
    const { event, actor } = 'event' in x ? x : { event: x, actor: world.player.id };
    const kind = EVENT_AUDIENCE[event.type];
    if (kind === 'self') return { event, audience: { kind, player: actor } };
    if (kind === 'zone') return { event, audience: { kind } };
    const id = anchorOf(event);
    const actorPlayer = world.playerById(actor) ?? world.player;
    const at = (id !== null ? world.playerById(id) ?? world.get(id) : null) ?? actorPlayer;
    return { event, audience: { kind, x: at.x, z: at.z } };
  });
}
