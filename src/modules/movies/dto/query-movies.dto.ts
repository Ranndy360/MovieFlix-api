import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

import { ToBoolean } from '../../../common/transforms/to-boolean.transform';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MovieGenre } from '../entities/movie.entity';
import { MAX_RELEASE_YEAR, MIN_RELEASE_YEAR } from './create-movie.dto';

export enum MovieSortBy {
  Title = 'title',
  ReleaseYear = 'releaseYear',
  Rating = 'rating',
  CreatedAt = 'createdAt',
}

export class QueryMoviesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Case-insensitive partial match on title' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ enum: MovieGenre })
  @IsOptional()
  @IsEnum(MovieGenre)
  genre?: MovieGenre;

  @ApiPropertyOptional({ minimum: MIN_RELEASE_YEAR, maximum: MAX_RELEASE_YEAR })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_RELEASE_YEAR)
  @Max(MAX_RELEASE_YEAR)
  releaseYear?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isPublished?: boolean;

  @ApiPropertyOptional({
    description: 'Only the movies the caller created. For the management screen.',
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({ enum: MovieSortBy, default: MovieSortBy.CreatedAt })
  @IsOptional()
  @IsEnum(MovieSortBy)
  sortBy: MovieSortBy = MovieSortBy.CreatedAt;
}
