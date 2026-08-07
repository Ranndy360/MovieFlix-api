import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  CreateReviewDto,
  QueryReviewsDto,
  ReviewResponseDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('reviews')
@Controller({ path: 'reviews', version: '1' })
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Leave a review on a movie',
    description:
      'Requires the movie to be marked WATCHED on your watchlist, and allows at most ' +
      'one review per movie.',
  })
  @ApiCreatedResponse({ type: ReviewResponseDto })
  @ApiNotFoundResponse({ description: 'No such movie in the catalog' })
  @ApiUnprocessableEntityResponse({ description: 'The movie is not marked as watched' })
  @ApiConflictResponse({ description: 'You have already reviewed this movie' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReviewDto,
  ): Promise<ReviewResponseDto> {
    return this.reviewsService.create(userId, dto);
  }

  /**
   * Requires a session, like the catalog it describes. `ReviewResponseDto`
   * embeds the full `movie`, so leaving this public would hand out the entire
   * private catalog through the back door.
   */
  @Get()
  @ApiBearerAuth('access-token')
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  @ApiOperation({ summary: 'List reviews, optionally for one movie' })
  @ApiPaginatedResponse(ReviewResponseDto, 'Paginated reviews')
  findAll(@Query() query: QueryReviewsDto): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    return this.reviewsService.findAll(query);
  }

  /**
   * Declared before `:id` — Express matches in order, so a literal segment
   * placed after a parameter route would never be reached.
   */
  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'List the reviews I have written' })
  @ApiPaginatedResponse(ReviewResponseDto, 'Paginated reviews by the current user')
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  findMine(
    @CurrentUser('id') userId: string,
    @Query() query: QueryReviewsDto,
  ): Promise<PaginatedResponseDto<ReviewResponseDto>> {
    return this.reviewsService.findMine(userId, query);
  }

  /**
   * POST, not PATCH: this deployment's environment rejects PATCH, so the
   * partial-update routes use POST on the same path. Semantically these are
   * still partial updates — hence the explicit 200, since Nest answers 201 to
   * a POST by default and nothing is being created here.
   */
  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Edit my review' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReviewResponseDto })
  @ApiNotFoundResponse({ description: 'No such review' })
  @ApiForbiddenResponse({ description: 'The review belongs to another user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateReviewDto,
  ): Promise<ReviewResponseDto> {
    return this.reviewsService.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Delete my review' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Review deleted' })
  @ApiNotFoundResponse({ description: 'No such review' })
  @ApiForbiddenResponse({ description: 'The review belongs to another user' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.reviewsService.remove(userId, id);
  }
}
