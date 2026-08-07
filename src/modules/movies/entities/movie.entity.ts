import {
  Column,
  CreatedAt,
  DataType,
  DeletedAt,
  Default,
  Index,
  Model,
  PrimaryKey,
  Table,
  UpdatedAt,
} from 'sequelize-typescript';

export enum MovieGenre {
  Action = 'ACTION',
  Adventure = 'ADVENTURE',
  Animation = 'ANIMATION',
  Comedy = 'COMEDY',
  Documentary = 'DOCUMENTARY',
  Drama = 'DRAMA',
  Horror = 'HORROR',
  Romance = 'ROMANCE',
  SciFi = 'SCI_FI',
  Thriller = 'THRILLER',
}

export interface MovieAttributes {
  id: string;
  /**
   * Who added it. `null` for seeded rows, which only an ADMIN can manage —
   * a PROVIDER manages exactly what they created.
   */
  createdById: string | null;
  title: string;
  synopsis: string | null;
  genre: MovieGenre;
  releaseYear: number;
  durationMinutes: number;
  rating: number;
  posterUrl: string | null;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export type MovieCreationAttributes = Omit<
  MovieAttributes,
  'id' | 'createdById' | 'createdAt' | 'updatedAt' | 'deletedAt'
> &
  Partial<Pick<MovieAttributes, 'id' | 'createdById'>>;

/**
 * Columns are declared `field`-explicit because the connection runs with
 * `underscored: true`; keeping both sides visible avoids surprise renames.
 */
@Table({
  tableName: 'movies',
  timestamps: true,
  paranoid: true,
  underscored: true,
})
export class Movie extends Model<MovieAttributes, MovieCreationAttributes> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  // `override`: Sequelize's base `Model` already declares a loosely-typed `id`.
  @Column({ type: DataType.UUID, allowNull: false })
  override id!: string;

  @Index('movies_title_idx')
  @Column({ type: DataType.STRING(200), allowNull: false })
  title!: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  synopsis!: string | null;

  @Index('movies_genre_idx')
  @Column({ type: DataType.ENUM(...Object.values(MovieGenre)), allowNull: false })
  genre!: MovieGenre;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'release_year' })
  releaseYear!: number;

  @Column({ type: DataType.SMALLINT, allowNull: false, field: 'duration_minutes' })
  durationMinutes!: number;

  /**
   * DECIMAL comes back from `pg` as a string; the getter keeps the public type
   * honest so callers never do arithmetic on `"8.40"`.
   */
  @Default(0)
  @Column({
    type: DataType.DECIMAL(3, 1),
    allowNull: false,
    get(this: Movie): number {
      const raw = this.getDataValue('rating') as unknown;
      return typeof raw === 'string' ? Number.parseFloat(raw) : ((raw as number) ?? 0);
    },
  })
  rating!: number;

  @Column({ type: DataType.STRING(2048), allowNull: true, field: 'poster_url' })
  posterUrl!: string | null;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'is_published' })
  isPublished!: boolean;

  @Index('movies_created_by_id_idx')
  @Column({ type: DataType.UUID, allowNull: true, field: 'created_by_id' })
  createdById!: string | null;

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
