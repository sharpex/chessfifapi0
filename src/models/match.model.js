import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database.js';

export class Match extends Model {}

Match.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    challengeId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    whitePlayerId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    blackPlayerId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    stake: {
      // per-player stake — the pot is stake * 2
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false
    },
    fen: {
      // current position, updated after every move — lets a reconnecting client (or a
      // server restart) recover exactly where the game was
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    },
    status: {
      type: DataTypes.ENUM('active', 'completed'),
      allowNull: false,
      defaultValue: 'active'
    },
    outcome: {
      // from White's perspective — resolved per-player in the API response
      type: DataTypes.ENUM('white_win', 'black_win', 'draw'),
      allowNull: true
    },
    endReason: {
      type: DataTypes.ENUM('checkmate', 'draw', 'resignation', 'timeout_forfeit', 'disconnect_forfeit', 'move_timeout_forfeit', 'mutual_disconnect_void'),
      allowNull: true
    },
    winnerId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    endedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // --- connection-loss tracking (server-authoritative version of the frontend's
    // client-side 5-minute countdown) ---
    connectionLostUserId: {
      type: DataTypes.UUID,
      allowNull: true
    },
    connectionLostAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // --- per-move clock (see chess/constants.js's MOVE_TIME_LIMIT_MS and
    // sockets/moveTimeoutTracker.js) ---
    // When the CURRENT mover's 30-second clock runs out, forfeiting the match to their
    // opponent. Set to "now + the limit" at match creation and after every accepted move;
    // null once the match ends (any reason, not just a move timeout — see settleMatch).
    // Persisted (rather than kept purely in the in-memory timer) so a reconnecting/resuming
    // client can render an accurate remaining countdown instead of a blind fresh 30s, and
    // so a stale deadline surviving a server restart can still be caught and enforced on the
    // next read/write for this match rather than silently granting extra time forever.
    turnDeadline: {
      type: DataTypes.DATE,
      allowNull: true
    },
    // How many milliseconds were left on the clock the moment it got paused (see
    // match.service.js's pauseMoveClock) — null whenever the clock isn't currently paused.
    // Exists so reconnecting/resuming restores the ACTUAL time that was left rather than
    // granting a fresh 30 seconds on every disconnect or page refresh, which — since a
    // refresh itself briefly disconnects and reconnects the socket — was otherwise
    // resetting the visible clock on every reload even when nothing about the position
    // had changed. See resumeMoveClockIfBothOnline for where this gets spent.
    pausedRemainingMs: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  },
  {
    sequelize,
    modelName: 'Match',
    tableName: 'matches',
    indexes: [
      { fields: ['white_player_id'] },
      { fields: ['black_player_id'] },
      { fields: ['status'] }
    ]
  }
);
