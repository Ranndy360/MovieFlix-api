import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UniqueConstraintError, type WhereOptions } from 'sequelize';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { Movie } from '../movies/entities/movie.entity';
import {
  AddWatchlistEntryDto,
  QueryWatchlistDto,
  WatchlistEntryResponseDto,
  WatchlistSortBy,
} from './dto/watchlist.dto';
import {
  WatchlistEntry,
  WatchlistStatus,
  type WatchlistEntryAttributes,
} from './entities/watchlist-entry.entity';

const SORT_COLUMN: Record<WatchlistSortBy, keyof WatchlistEntryAttributes> = {
  [WatchlistSortBy.CreatedAt]: 'createdAt',
  [WatchlistSortBy.UpdatedAt]: 'updatedAt',
  [WatchlistSortBy.WatchedAt]: 'watchedAt',
};

/**
 * Owns the personal watchlist. Knows nothing about reviews — `ReviewsService`
 * depends on this one, never the other way round, which keeps the module graph
 * acyclic.
 */
@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(
    @InjectModel(WatchlistEntry) private readonly entryModel: typeof WatchlistEntry,
    @InjectModel(Movie) private readonly movieModel: typeof Movie,
  ) {}

  async add(userId: string, dto: AddWatchlistEntryDto): Promise<WatchlistEntryResponseDto> {
    const movie = await this.movieModel.findByPk(dto.movieId);

    if (!movie) {
      throw new NotFoundException(`Movie with id "${dto.movieId}" was not found`);
    }

    const status = dto.status ?? WatchlistStatus.Want;

    try {
      const entry = await this.entryModel.create({
        userId,
        movieId: dto.movieId,
        status,
        watchedAt: status === WatchlistStatus.Watched ? new Date() : null,
      });

      entry.movie = movie;
      this.logger.log(`User ${userId} added movie ${dto.movieId} as ${status}`);

      return WatchlistEntryResponseDto.fromEntity(entry);
    } catch (error) {
      // Two concurrent adds race past the pre-check; the unique index is the
      // real guard, so translate its error rather than trusting a prior SELECT.
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('This movie is already on your watchlist');
      }
      throw error;
    }
  }

  async updateStatus(
    userId: string,
    movieId: string,
    status: WatchlistStatus,
  ): Promise<WatchlistEntryResponseDto> {
    const entry = await this.findEntryOrFail(userId, movieId);

    await entry.update({
      status,
      // Stamp the first transition into WATCHED and keep it: it records when
      // they saw the film, not when they last touched the row.
      watchedAt:
        status === WatchlistStatus.Watched ? (entry.watchedAt ?? new Date()) : entry.watchedAt,
    });

    this.logger.log(`User ${userId} set movie ${movieId} to ${status}`);

    return WatchlistEntryResponseDto.fromEntity(entry);
  }

  async findMine(
    userId: string,
    query: QueryWatchlistDto,
  ): Promise<PaginatedResponseDto<WatchlistEntryResponseDto>> {
    const where: WhereOptions<WatchlistEntryAttributes> = { userId };

    if (query.status) {
      Object.assign(where, { status: query.status });
    }

    const { rows, count } = await this.entryModel.findAndCountAll({
      where,
      include: [{ model: Movie, required: true }],
      order: [[SORT_COLUMN[query.sortBy], query.sortDirection]],
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    return PaginatedResponseDto.from(
      WatchlistEntryResponseDto.fromEntities(rows),
      count,
      query.page,
      query.pageSize,
    );
  }

  async remove(userId: string, movieId: string): Promise<void> {
    const entry = await this.findEntryOrFail(userId, movieId);
    await entry.destroy();

    this.logger.log(`User ${userId} removed movie ${movieId} from their watchlist`);
  }

  /**
   * The gate behind "you may only review what you have watched".
   * Consumed by `ReviewsService`.
   */
  async hasWatched(userId: string, movieId: string): Promise<boolean> {
    const count = await this.entryModel.count({
      where: { userId, movieId, status: WatchlistStatus.Watched },
    });

    return count > 0;
  }

  /** Per-status totals for the profile, in a single grouped query. */
  async countByStatus(userId: string): Promise<Record<WatchlistStatus, number>> {
    const rows = await this.entryModel.findAll({
      attributes: [
        'status',
        [this.entryModel.sequelize!.fn('COUNT', this.entryModel.sequelize!.col('id')), 'total'],
      ],
      where: { userId },
      group: ['status'],
      raw: true,
    });

    const counts: Record<WatchlistStatus, number> = {
      [WatchlistStatus.Want]: 0,
      [WatchlistStatus.Watching]: 0,
      [WatchlistStatus.Watched]: 0,
    };

    for (const row of rows as unknown as { status: WatchlistStatus; total: string }[]) {
      counts[row.status] = Number(row.total);
    }

    return counts;
  }

  private async findEntryOrFail(userId: string, movieId: string): Promise<WatchlistEntry> {
    const entry = await this.entryModel.findOne({
      where: { userId, movieId },
      include: [{ model: Movie, required: false }],
    });

    if (!entry) {
      throw new NotFoundException(`Movie with id "${movieId}" is not on your watchlist`);
    }

    return entry;
  }
}
