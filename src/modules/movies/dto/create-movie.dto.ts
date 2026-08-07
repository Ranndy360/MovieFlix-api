import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

import { ToBoolean } from '../../../common/transforms/to-boolean.transform';
import { MovieGenre } from '../entities/movie.entity';

export const MIN_RELEASE_YEAR = 1888;
export const MAX_RELEASE_YEAR = 2100;

export class CreateMovieDto {
  @ApiProperty({ example: 'Blade Runner 2049', maxLength: 200 })
  @IsString()
  @Length(1, 200)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @ApiPropertyOptional({ example: 'A young blade runner uncovers a long-buried secret.' })
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  synopsis?: string;

  @ApiProperty({ enum: MovieGenre, example: MovieGenre.SciFi })
  @IsEnum(MovieGenre)
  genre!: MovieGenre;

  @ApiProperty({ example: 2017, minimum: MIN_RELEASE_YEAR, maximum: MAX_RELEASE_YEAR })
  @Type(() => Number)
  @IsInt()
  @Min(MIN_RELEASE_YEAR)
  @Max(MAX_RELEASE_YEAR)
  releaseYear!: number;

  @ApiProperty({ example: 164, minimum: 1, maximum: 1000, description: 'Runtime in minutes' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  durationMinutes!: number;

  @ApiPropertyOptional({ example: 8.4, minimum: 0, maximum: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(10)
  rating?: number;

  @ApiPropertyOptional({ example: 'https://cdn.movieflix.test/posters/br2049.jpg' })
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @Length(0, 2048)
  posterUrl?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isPublished?: boolean;
}
