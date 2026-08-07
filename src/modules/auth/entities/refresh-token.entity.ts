import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  ForeignKey,
  Index,
  Model,
  PrimaryKey,
  Table,
  Unique,
  UpdatedAt,
} from 'sequelize-typescript';

import { User } from '../../users/entities/user.entity';

export interface RefreshTokenAttributes {
  id: string;
  userId: string;
  /** JWT id — the lookup key carried inside the token itself. */
  jti: string;
  /** SHA-256 of the raw token. The token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  /** Set when this token was rotated, pointing at its successor. */
  replacedByJti: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type RefreshTokenCreationAttributes = Omit<
  RefreshTokenAttributes,
  'id' | 'revokedAt' | 'replacedByJti' | 'createdAt' | 'updatedAt'
> &
  Partial<RefreshTokenAttributes>;

/**
 * One row per issued refresh token — i.e. one row per active session.
 *
 * Storing them lets us do three things a stateless JWT cannot: revoke a single
 * session on logout, revoke every session at once, and detect replay of an
 * already-rotated token.
 */
@Table({ tableName: 'refresh_tokens', timestamps: true, underscored: true })
export class RefreshToken extends Model<RefreshTokenAttributes, RefreshTokenCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  override id!: string;

  @Index('refresh_tokens_user_id_idx')
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  userId!: string;

  @BelongsTo(() => User)
  user?: User;

  @Unique('refresh_tokens_jti_key')
  @Column({ type: DataType.UUID, allowNull: false })
  jti!: string;

  @Column({ type: DataType.STRING(64), allowNull: false, field: 'token_hash' })
  tokenHash!: string;

  @Column({ type: DataType.DATE, allowNull: false, field: 'expires_at' })
  expiresAt!: Date;

  @Column({ type: DataType.DATE, allowNull: true, field: 'revoked_at' })
  revokedAt!: Date | null;

  @Column({ type: DataType.UUID, allowNull: true, field: 'replaced_by_jti' })
  replacedByJti!: string | null;

  @Column({ type: DataType.STRING(512), allowNull: true, field: 'user_agent' })
  userAgent!: string | null;

  @Column({ type: DataType.STRING(64), allowNull: true, field: 'ip_address' })
  ipAddress!: string | null;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  declare updatedAt: Date;

  get isRevoked(): boolean {
    return this.revokedAt !== null;
  }

  isExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  isUsable(now: Date = new Date()): boolean {
    return !this.isRevoked && !this.isExpired(now);
  }
}
