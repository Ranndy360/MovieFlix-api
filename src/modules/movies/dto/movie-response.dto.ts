import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Movie, MovieGenre } from '../entities/movie.entity';

/**
 * The wire contract. Entities are never returned directly — that would leak
 * every column added later plus Sequelize internals.
 */
export class MovieResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Blade Runner 2049' })
  title!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  synopsis!: string | null;

  @ApiProperty({ enum: MovieGenre })
  genre!: MovieGenre;

  @ApiProperty({ example: 2017 })
  releaseYear!: number;

  @ApiProperty({ example: 164 })
  durationMinutes!: number;

  @ApiProperty({ example: 8.4 })
  rating!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  posterUrl!: string | null;

  @ApiProperty({ example: true })
  isPublished!: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description: 'Who added it. Null for seeded rows — only an ADMIN can manage those.',
  })
  createdById!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  static fromEntity(movie: Movie): MovieResponseDto {
    return {
      id: movie.id,
      title: movie.title,
      synopsis: movie.synopsis,
      genre: movie.genre,
      releaseYear: movie.releaseYear,
      durationMinutes: movie.durationMinutes,
      rating: movie.rating,
      posterUrl: movie.posterUrl,
      isPublished: movie.isPublished,
      createdById: movie.createdById,
      createdAt: movie.createdAt,
      updatedAt: movie.updatedAt,
    };
  }

  static fromEntities(movies: Movie[]): MovieResponseDto[] {
    return movies.map((movie) => MovieResponseDto.fromEntity(movie));
  }
}
