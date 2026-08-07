import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { UniqueConstraintError, type WhereOptions } from 'sequelize';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { Movie } from '../movies/entities/movie.entity';
import { User } from '../users/entities/user.entity';
import { WatchlistService } from '../watchlist/watchlist.service';
import {
  CreateReviewDto,
  QueryReviewsDto,
  ReviewResponseDto,
  ReviewSortBy,
  UpdateReviewDto,
} from './dto/review.dto';
import { Review, type ReviewAttributes } from './entities/review.entity';

const SORT_COLUMN: Record<ReviewSortBy, keyof ReviewAttributes> = {
  [ReviewSortBy.CreatedAt]: 'createdAt',
  [ReviewSortBy.Rating]: 'rating',
};

export interface RatingStats {
  totalReviews: number;
  /** `null` when the user has not reviewed anything — not `0`, which would be a real score. */
  averageRating: number | null;
}

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(
    @InjectModel(Review) private readonly reviewModel: typeof Review,
    @InjectModel(Movie) private readonly movieModel: typeof Movie,
    private readonly watchlistService: WatchlistService,
  ) {}

  /**
   * Enforces both business rules:
   *   1. the movie must be marked `WATCHED` on the caller's watchlist;
   *   2. at most one live review per (user, movie).
   */
  async create(userId: string, dto: CreateReviewDto): Promise<ReviewResponseDto> {
    const movie = await this.movieModel.findByPk(dto.movieId);

    if (!movie) {
      throw new NotFoundException(`Movie with id "${dto.movieId}" was not found`);
    }

    if (!(await this.watchlistService.hasWatched(userId, dto.movieId))) {
      // 422, not 403: the request is well-formed and the caller is entitled to
      // review — the *state* of their watchlist is what makes it impossible.
      throw new UnprocessableEntityException(
        'You can only review a movie you have marked as watched',
      );
    }

    try {
      const review = await this.reviewModel.create({
        userId,
        movieId: dto.movieId,
        rating: dto.rating,
        comment: dto.comment ?? null,
      });

      this.logger.log(`User ${userId} reviewed movie ${dto.movieId} with ${dto.rating}/5`);

      // Re-read instead of hand-assembling: one extra SELECT on a rare write
      // buys a response identical in shape to every other review endpoint,
      // author included. A create that answered with a different shape from a
      // list is the kind of inconsistency clients end up working around.
      return ReviewResponseDto.fromEntity(await this.findOwnedOrFail(userId, review.id));
    } catch (error) {
      // The partial unique index is the authority: two concurrent creates can
      // both pass an application-level check, but only one can be written.
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException('You have already reviewed this movie');
      }
      throw error;
    }
  }

  async update(userId: string, reviewId: string, dto: UpdateReviewDto): Promise<ReviewResponseDto> {
    const review = await this.findOwnedOrFail(userId, reviewId);

    const patch: Partial<ReviewAttributes> = {};
    if (dto.rating !== undefined) patch.rating = dto.rating;
    if (dto.comment !== undefined) patch.comment = dto.comment;

    await review.update(patch);

    this.logger.log(`User ${userId} updated review ${reviewId}`);

    return ReviewResponseDto.fromEntity(review);
  }

  async remove(userId: string, reviewId: string): Promise<void> {
    const review = await this.findOwnedOrFail(userId, reviewId);
    await review.destroy();

    this.logger.log(`User ${userId} deleted review ${reviewId}`);
  }

  /** Public: everyone can read the reviews of a movie. */
  async findAll(query: QueryReviewsDto): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    const where: WhereOptions<ReviewAttributes> = {};

    if (query.movieId) {
      Object.assign(where, { movieId: query.movieId });
    }

    return this.paginate(where, query);
  }

  async findMine(
    userId: string,
    query: QueryReviewsDto,
  ): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    const where: WhereOptions<ReviewAttributes> = { userId };

    if (query.movieId) {
      Object.assign(where, { movieId: query.movieId });
    }

    return this.paginate(where, query);
  }

  /** Feeds the profile's "average rating given". */
  async getRatingStats(userId: string): Promise<RatingStats> {
    const sequelize = this.reviewModel.sequelize!;

    const row = (await this.reviewModel.findOne({
      attributes: [
        [sequelize.fn('COUNT', sequelize.col('id')), 'total'],
        [sequelize.fn('AVG', sequelize.col('rating')), 'average'],
      ],
      where: { userId },
      raw: true,
    })) as unknown as { total: string; average: string | null } | null;

    const totalReviews = Number(row?.total ?? 0);

    return {
      totalReviews,
      // AVG returns a string from `pg`, and null when there are no rows.
      averageRating:
        totalReviews > 0 && row?.average != null
          ? Math.round(Number(row.average) * 100) / 100
          : null,
    };
  }

  private async paginate(
    where: WhereOptions<ReviewAttributes>,
    query: QueryReviewsDto,
  ): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    const { rows, count } = await this.reviewModel.findAndCountAll({
      where,
      include: [
        { model: Movie, required: true },
        // Named columns, not the whole row: `attributes` is what guarantees the
        // password hash and the email never leave the database for this query.
        { model: User, required: true, attributes: ['id', 'firstName', 'lastName'] },
      ],
      order: [[SORT_COLUMN[query.sortBy], query.sortDirection]],
      limit: query.limit,
      offset: query.offset,
      distinct: true,
    });

    return PaginatedResponseDto.from(
      ReviewResponseDto.fromEntities(rows),
      count,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Loads a review and asserts the caller owns it.
   *
   * A review that exists but belongs to someone else yields 403 rather than
   * 404: reviews are public content, so their existence is not a secret and a
   * precise error is more useful than a misleading one.
   */
  private async findOwnedOrFail(userId: string, reviewId: string): Promise<Review> {
    const review = await this.reviewModel.findByPk(reviewId, {
      include: [
        { model: Movie, required: false },
        { model: User, required: false, attributes: ['id', 'firstName', 'lastName'] },
      ],
    });

    if (!review) {
      throw new NotFoundException(`Review with id "${reviewId}" was not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException('You can only modify your own review');
    }

    return review;
  }
}
