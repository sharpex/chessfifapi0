import { Op } from 'sequelize';
import { User, Challenge } from '../../models/index.js';
import { getOnlineUserIds } from '../../sockets/presence.js';

/** The frontend's lobby table shows one stake number per player and uses it directly as
 *  the amount you'd be challenging them for — there's no separate "pick your stake" step
 *  on that path (see PlayersView.jsx / handleChallengeClick). So each online player here
 *  needs a concrete stake: their own currently-open challenge amount if they've posted
 *  one, otherwise this fallback. A product could instead use a per-user "preferred stake"
 *  setting — not built, since nothing currently asks for one. */
const DEFAULT_DISPLAY_STAKE = 10;

export async function getOnlinePlayers(excludeUserId) {
  const onlineIds = getOnlineUserIds().filter(id => id !== excludeUserId);
  if (onlineIds.length === 0) return [];

  const [users, openChallenges] = await Promise.all([
    User.findAll({ where: { id: onlineIds } }),
    Challenge.findAll({ where: { creatorId: onlineIds, status: 'open', opponentId: null } })
  ]);

  const stakeByCreator = new Map(openChallenges.map(c => [c.creatorId, Number(c.stake)]));
  return users.map(u => ({
    id: u.id,
    name: u.name,
    stake: stakeByCreator.get(u.id) ?? DEFAULT_DISPLAY_STAKE
  }));
}

/** Every currently-open challenge anyone can accept, newest first — distinct from the
 *  per-player stake shown above (that's "what would it cost to challenge this online
 *  player", derived data; this is the actual postable/acceptable Challenge rows). Visible
 *  to guests too (see lobby.routes.js) — browsing what's available doesn't need an
 *  account, only accepting one does. excludeUserId (when signed in) drops the person's own
 *  open challenge, since accepting your own isn't a real option. */
export async function getOpenChallenges(excludeUserId) {
  const where = { status: 'open', opponentId: null };
  if (excludeUserId) where.creatorId = { [Op.ne]: excludeUserId };
  const challenges = await Challenge.findAll({
    where,
    include: [{ model: User, as: 'creator' }],
    order: [['createdAt', 'DESC']],
    limit: 50
  });
  return challenges.map(c => ({
    id: c.id,
    creatorName: c.creator?.name ?? 'Unknown',
    stake: Number(c.stake),
    createdAt: c.createdAt
  }));
}
