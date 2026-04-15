import { schema, table, t, SenderError } from 'spacetimedb/server';

const spacetimedb = schema({
  player: table(
    { public: true },
    {
      identity: t.identity().primaryKey(),
      x: t.f32(),
      y: t.f32(),
      directionX: t.i32(), // -1, 0, or 1
      color: t.u32(),      // hex color for this player
    }
  ),
});

export default spacetimedb;

// Assign a random-ish color based on identity
function identityToColor(identity: { toHexString(): string }): number {
  const hex = identity.toHexString();
  const r = parseInt(hex.slice(0, 2), 16) | 0x40;
  const g = parseInt(hex.slice(2, 4), 16) | 0x40;
  const b = parseInt(hex.slice(4, 6), 16) | 0x40;
  return (r << 16) | (g << 8) | b;
}

export const onConnect = spacetimedb.clientConnected((ctx) => {
  const color = identityToColor(ctx.sender);
  ctx.db.player.insert({
    identity: ctx.sender,
    x: 400,
    y: 300,
    directionX: 0,
    color,
  });
});

export const onDisconnect = spacetimedb.clientDisconnected((ctx) => {
  const player = ctx.db.player.identity.find(ctx.sender);
  if (player) {
    ctx.db.player.identity.delete(ctx.sender);
  }
});

export const update_position = spacetimedb.reducer(
  {
    x: t.f32(),
    y: t.f32(),
    directionX: t.i32(),
  },
  (ctx, { x, y, directionX }) => {
    const player = ctx.db.player.identity.find(ctx.sender);
    if (!player) throw new SenderError('Player not found');
    ctx.db.player.identity.update({ ...player, x, y, directionX });
  }
);
