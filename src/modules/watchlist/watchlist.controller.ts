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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  AddWatchlistEntryDto,
  QueryWatchlistDto,
  UpdateWatchlistStatusDto,
  WatchlistEntryResponseDto,
} from './dto/watchlist.dto';
import { WatchlistService } from './watchlist.service';

/**
 * The caller's own watchlist. Every route derives the owner from the access
 * token, so there is no user id in any path or body — one user can never read
 * or modify another's list.
 *
 * Entries are addressed by `movieId` rather than entry id: `(user, movie)` is
 * unique, so the client already holds everything needed to name the resource.
 */
@ApiTags('watchlist')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
@Controller({ path: 'watchlist', version: '1' })
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Post()
  @ApiOperation({ summary: 'Add a movie to my watchlist' })
  @ApiCreatedResponse({ type: WatchlistEntryResponseDto })
  @ApiNotFoundResponse({ description: 'No such movie in the catalog' })
  @ApiConflictResponse({ description: 'The movie is already on the watchlist' })
  add(
    @CurrentUser('id') userId: string,
    @Body() dto: AddWatchlistEntryDto,
  ): Promise<WatchlistEntryResponseDto> {
    return this.watchlistService.add(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'View my full watchlist' })
  @ApiPaginatedResponse(WatchlistEntryResponseDto, 'Paginated watchlist, newest first')
  findMine(
    @CurrentUser('id') userId: string,
    @Query() query: QueryWatchlistDto,
  ): Promise<PaginatedResponseDto<WatchlistEntryResponseDto>> {
    return this.watchlistService.findMine(userId, query);
  }

  /**
   * POST, not PATCH: this deployment's environment rejects PATCH, so the
   * partial-update routes use POST on the same path. Semantically these are
   * still partial updates — hence the explicit 200, since Nest answers 201 to
   * a POST by default and nothing is being created here.
   */
  @Post(':movieId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update the status of a movie on my watchlist' })
  @ApiParam({ name: 'movieId', format: 'uuid' })
  @ApiOkResponse({ type: WatchlistEntryResponseDto })
  @ApiNotFoundResponse({ description: 'The movie is not on the watchlist' })
  updateStatus(
    @CurrentUser('id') userId: string,
    @Param('movieId', new ParseUUIDPipe({ version: '4' })) movieId: string,
    @Body() dto: UpdateWatchlistStatusDto,
  ): Promise<WatchlistEntryResponseDto> {
    return this.watchlistService.updateStatus(userId, movieId, dto.status);
  }

  @Delete(':movieId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a movie from my watchlist' })
  @ApiParam({ name: 'movieId', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Entry removed' })
  @ApiNotFoundResponse({ description: 'The movie is not on the watchlist' })
  remove(
    @CurrentUser('id') userId: string,
    @Param('movieId', new ParseUUIDPipe({ version: '4' })) movieId: string,
  ): Promise<void> {
    return this.watchlistService.remove(userId, movieId);
  }
}
