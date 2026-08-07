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
  UpdatedAt,
} from 'sequelize-typescript';

import { Movie } from '../../movies/entities/movie.entity';
import { User } from '../../users/entities/user.entity';

export enum WatchlistStatus {
  Want = 'WANT',
  Watching = 'WATCHING',
  Watched = 'WATCHED',
}

export const ALL_WATCHLIST_STATUSES = Object.values(WatchlistStatus);

export interface WatchlistEntryAttributes {
  id: string;
  userId: string;
  movieId: string;
  status: WatchlistStatus;
  /** Stamped the first time the entry reaches `WATCHED`. */
  watchedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type WatchlistEntryCreationAttributes = Omit<
  WatchlistEntryAttributes,
  'id' | 'watchedAt' | 'createdAt' | 'updatedAt'
> &
  Partial<WatchlistEntryAttributes>;

/**
 * A movie on one user's personal list.
 *
 * `(user_id, movie_id)` is unique: the list is a set, so "add" is either a
 * create or a 409 — never a silent duplicate.
 *
 * Associations are declared only on this side. Adding the matching `@HasMany`
 * to `Movie`/`User` would make those entity modules import this one and create
 * a circular import between entity files.
 */
@Table({ tableName: 'watchlist_entries', timestamps: true, underscored: true })
export class WatchlistEntry extends Model<
  WatchlistEntryAttributes,
  WatchlistEntryCreationAttributes
> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  override id!: string;

  @Index('watchlist_entries_user_id_idx')
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  userId!: string;

  @BelongsTo(() => User)
  user?: User;

  @ForeignKey(() => Movie)
  @Column({ type: DataType.UUID, allowNull: false, field: 'movie_id' })
  movieId!: string;

  @BelongsTo(() => Movie)
  movie?: Movie;

  @Default(WatchlistStatus.Want)
  @Column({ type: DataType.ENUM(...ALL_WATCHLIST_STATUSES), allowNull: false })
  status!: WatchlistStatus;

  @Column({ type: DataType.DATE, allowNull: true, field: 'watched_at' })
  watchedAt!: Date | null;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  declare updatedAt: Date;

  get isWatched(): boolean {
    return this.status === WatchlistStatus.Watched;
  }
}
