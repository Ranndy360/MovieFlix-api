import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MovieResponseDto } from '../../movies/dto/movie-response.dto';
import { WatchlistEntry, WatchlistStatus } from '../entities/watchlist-entry.entity';

export class AddWatchlistEntryDto {
  @ApiProperty({ format: 'uuid', description: 'Movie from the global catalog.' })
  @IsUUID('4', { message: 'movieId must be a valid UUID' })
  movieId!: string;

  @ApiPropertyOptional({
    enum: WatchlistStatus,
    default: WatchlistStatus.Want,
    description: 'Defaults to WANT.',
  })
  @IsOptional()
  @IsEnum(WatchlistStatus)
  status?: WatchlistStatus;
}

export class UpdateWatchlistStatusDto {
  @ApiProperty({ enum: WatchlistStatus })
  @IsEnum(WatchlistStatus)
  status!: WatchlistStatus;
}

export enum WatchlistSortBy {
  CreatedAt = 'createdAt',
  UpdatedAt = 'updatedAt',
  WatchedAt = 'watchedAt',
}

export class QueryWatchlistDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: WatchlistStatus, description: 'Filter to a single status.' })
  @IsOptional()
  @IsEnum(WatchlistStatus)
  status?: WatchlistStatus;

  @ApiPropertyOptional({ enum: WatchlistSortBy, default: WatchlistSortBy.CreatedAt })
  @IsOptional()
  @IsEnum(WatchlistSortBy)
  sortBy: WatchlistSortBy = WatchlistSortBy.CreatedAt;
}

export class WatchlistEntryResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  movieId!: string;

  @ApiProperty({ enum: WatchlistStatus })
  status!: WatchlistStatus;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  watchedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiPropertyOptional({
    type: MovieResponseDto,
    description: 'The catalog movie, present when the association was loaded.',
  })
  movie?: MovieResponseDto;

  static fromEntity(entry: WatchlistEntry): WatchlistEntryResponseDto {
    return {
      id: entry.id,
      movieId: entry.movieId,
      status: entry.status,
      watchedAt: entry.watchedAt,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(entry.movie ? { movie: MovieResponseDto.fromEntity(entry.movie) } : {}),
    };
  }

  static fromEntities(entries: WatchlistEntry[]): WatchlistEntryResponseDto[] {
    return entries.map((entry) => WatchlistEntryResponseDto.fromEntity(entry));
  }
}
