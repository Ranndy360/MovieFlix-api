import {
  BelongsTo,
  Column,
  CreatedAt,
  DataType,
  Default,
  DeletedAt,
  ForeignKey,
  Index,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

import { Movie } from '../../movies/entities/movie.entity';
import { User } from '../../users/entities/user.entity';

export const MIN_REVIEW_RATING = 1;
export const MAX_REVIEW_RATING = 5;

export interface ReviewAttributes {
  id: string;
  userId: string;
  movieId: string;
  /** 1–5. Distinct from `Movie.rating`, which is the 0–10 catalog score. */
  rating: number;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type ReviewCreationAttributes = Omit<
  ReviewAttributes,
  'id' | 'createdAt' | 'updatedAt' | 'deletedAt'
> &
  Partial<ReviewAttributes>;

/**
 * One user's review of one movie.
 *
 * Uniqueness on `(user_id, movie_id)` is enforced by a **partial** index that
 * ignores soft-deleted rows, so deleting a review frees the slot for a new one
 * instead of permanently blocking it.
 */
@Table({ tableName: 'reviews', timestamps: true, paranoid: true, underscored: true })
export class Review extends Model<ReviewAttributes, ReviewCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  override id!: string;

  @Index('reviews_user_id_idx')
  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false, field: 'user_id' })
  userId!: string;

  @BelongsTo(() => User)
  user?: User;

  @Index('reviews_movie_id_idx')
  @ForeignKey(() => Movie)
  @Column({ type: DataType.UUID, allowNull: false, field: 'movie_id' })
  movieId!: string;

  @BelongsTo(() => Movie)
  movie?: Movie;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  rating!: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  comment!: string | null;

  @CreatedAt
  @Column({ type: DataType.DATE, field: 'created_at' })
  declare createdAt: Date;

  @UpdatedAt
  @Column({ type: DataType.DATE, field: 'updated_at' })
  declare updatedAt: Date;

  @DeletedAt
  @Column({ type: DataType.DATE, field: 'deleted_at' })
  declare deletedAt: Date | null;
}
