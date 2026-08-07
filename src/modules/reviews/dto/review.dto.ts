import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min, IsUUID } from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { MovieResponseDto } from '../../movies/dto/movie-response.dto';
import { MAX_REVIEW_RATING, MIN_REVIEW_RATING, Review } from '../entities/review.entity';

const RATING_MESSAGE = `rating must be a whole number between ${MIN_REVIEW_RATING} and ${MAX_REVIEW_RATING}`;

export class CreateReviewDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'movieId must be a valid UUID' })
  movieId!: string;

  @ApiProperty({ minimum: MIN_REVIEW_RATING, maximum: MAX_REVIEW_RATING, example: 4 })
  @Type(() => Number)
  @IsInt({ message: RATING_MESSAGE })
  @Min(MIN_REVIEW_RATING, { message: RATING_MESSAGE })
  @Max(MAX_REVIEW_RATING, { message: RATING_MESSAGE })
  rating!: number;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  comment?: string;
}

/**
 * Not `PartialType(CreateReviewDto)`: `movieId` must not be patchable. Letting
 * a review move between movies would sidestep both the "watched" check and the
 * one-review-per-movie rule.
 */
export class UpdateReviewDto {
  @ApiPropertyOptional({ minimum: MIN_REVIEW_RATING, maximum: MAX_REVIEW_RATING })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: RATING_MESSAGE })
  @Min(MIN_REVIEW_RATING, { message: RATING_MESSAGE })
  @Max(MAX_REVIEW_RATING, { message: RATING_MESSAGE })
  rating?: number;

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString()
  @Length(1, 5000)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  comment?: string;
}

export enum ReviewSortBy {
  CreatedAt = 'createdAt',
  Rating = 'rating',
}

export class QueryReviewsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Only reviews of this movie.' })
  @IsOptional()
  @IsUUID('4', { message: 'movieId must be a valid UUID' })
  movieId?: string;

  @ApiPropertyOptional({ enum: ReviewSortBy, default: ReviewSortBy.CreatedAt })
  @IsOptional()
  @IsEnum(ReviewSortBy)
  sortBy: ReviewSortBy = ReviewSortBy.CreatedAt;
}

/**
 * Who wrote a review, as everyone else is allowed to see them.
 *
 * Deliberately only the display name. Reviews are readable by every signed-in
 * user, so putting `email` here would hand the whole address book to anyone who
 * opens a popular movie — an account-enumeration list, served as JSON.
 */
export class ReviewAuthorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Grace Hopper' })
  fullName!: string;
}

export class ReviewResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  movieId!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ minimum: MIN_REVIEW_RATING, maximum: MAX_REVIEW_RATING })
  rating!: number;

  @ApiProperty({ nullable: true, type: String })
  comment!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiPropertyOptional({ type: MovieResponseDto })
  movie?: MovieResponseDto;

  @ApiPropertyOptional({ type: ReviewAuthorDto })
  author?: ReviewAuthorDto;

  static fromEntity(review: Review): ReviewResponseDto {
    return {
      id: review.id,
      movieId: review.movieId,
      userId: review.userId,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      ...(review.movie ? { movie: MovieResponseDto.fromEntity(review.movie) } : {}),
      ...(review.user ? { author: { id: review.user.id, fullName: review.user.fullName } } : {}),
    };
  }

  static fromEntities(reviews: Review[]): ReviewResponseDto[] {
    return reviews.map((review) => ReviewResponseDto.fromEntity(review));
  }
}
