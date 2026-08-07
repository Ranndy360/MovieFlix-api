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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { ApiExtraModels, getSchemaPath } from '@nestjs/swagger';

import { ApiPaginatedResponse } from '../../common/decorators/api-paginated-response.decorator';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import type { AuthenticatedUser } from '../auth/auth.constants';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../roles/entities/role.entity';
import type { UploadedFile as StorageFile } from '../storage/storage.service';
import { SINGLE_IMAGE_UPLOAD } from '../storage/upload.constants';
import { CreateMovieDto } from './dto/create-movie.dto';
import { MovieResponseDto } from './dto/movie-response.dto';
import { QueryMoviesDto } from './dto/query-movies.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { MoviesService } from './movies.service';

/**
 * The catalog requires a session. Reading needs any signed-in user; changing
 * it needs ADMIN or PROVIDER.
 *
 * There is no `@Public()` here on purpose: authentication is deny-by-default
 * globally, so leaving the decorator off is what keeps the catalog private.
 * Protecting only the frontend route would be cosmetic — the API is the real
 * boundary, and anyone can curl it.
 */
@ApiTags('movies')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({ description: 'Missing or invalid session' })
@ApiExtraModels(CreateMovieDto, UpdateMovieDto)
@Controller({ path: 'movies', version: '1' })
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  /**
   * Accepts **either** `application/json` **or** `multipart/form-data`.
   *
   * `FileInterceptor` wraps multer, which ignores any request that is not
   * multipart — so existing JSON clients are unaffected, and a form upload
   * gets its poster stored. Multipart fields arrive as strings; the global
   * `ValidationPipe` runs with `enableImplicitConversion`, which coerces
   * `releaseYear` and friends back to numbers.
   */
  @Post()
  @Roles(RoleName.Admin, RoleName.Provider)
  @UseInterceptors(FileInterceptor('poster', SINGLE_IMAGE_UPLOAD))
  @ApiBearerAuth('access-token')
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    description:
      'Movie fields, plus an optional `poster` image file (JPEG, PNG, WebP or AVIF). ' +
      'When a file is sent it takes precedence over any `posterUrl` in the body.',
    schema: {
      allOf: [
        { $ref: getSchemaPath(CreateMovieDto) },
        { type: 'object', properties: { poster: { type: 'string', format: 'binary' } } },
      ],
    },
  })
  @ApiForbiddenResponse({ description: 'Requires the ADMIN or PROVIDER role' })
  @ApiOperation({ summary: 'Create a movie, optionally uploading its poster (admin or provider)' })
  @ApiCreatedResponse({ type: MovieResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed' })
  @ApiUnprocessableEntityResponse({ description: 'The uploaded file is not a supported image' })
  @ApiServiceUnavailableResponse({ description: 'Object storage is unavailable or unconfigured' })
  create(
    @CurrentUser() author: AuthenticatedUser,
    @Body() dto: CreateMovieDto,
    @UploadedFile() poster?: StorageFile,
  ): Promise<MovieResponseDto> {
    return this.moviesService.create(dto, author, poster);
  }

  @Get()
  @ApiOperation({ summary: 'List movies with filtering, sorting and pagination' })
  @ApiPaginatedResponse(MovieResponseDto, 'Paginated movie list')
  findAll(
    @CurrentUser() viewer: AuthenticatedUser,
    @Query() query: QueryMoviesDto,
  ): Promise<PaginatedResponseDto<MovieResponseDto>> {
    return this.moviesService.findAll(query, viewer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single movie' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MovieResponseDto })
  @ApiNotFoundResponse({ description: 'Movie does not exist' })
  findOne(
    @CurrentUser() viewer: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<MovieResponseDto> {
    return this.moviesService.findOne(id, viewer);
  }

  /**
   * POST, not PATCH: this deployment's environment rejects PATCH, so the
   * partial-update routes use POST on the same path. Semantically these are
   * still partial updates — hence the explicit 200, since Nest answers 201 to
   * a POST by default and nothing is being created here.
   */
  @Post(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(RoleName.Admin, RoleName.Provider)
  @UseInterceptors(FileInterceptor('poster', SINGLE_IMAGE_UPLOAD))
  @ApiBearerAuth('access-token')
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    description:
      'Any subset of the movie fields, plus an optional `poster` image file to replace the ' +
      'current artwork. Omitting the file leaves the existing poster untouched.',
    schema: {
      allOf: [
        { $ref: getSchemaPath(UpdateMovieDto) },
        { type: 'object', properties: { poster: { type: 'string', format: 'binary' } } },
      ],
    },
  })
  @ApiForbiddenResponse({ description: 'Providers may only edit their own movies' })
  @ApiOperation({ summary: 'Partially update a movie (admin, or the provider who created it)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: MovieResponseDto })
  @ApiNotFoundResponse({ description: 'Movie does not exist' })
  @ApiUnprocessableEntityResponse({ description: 'The uploaded file is not a supported image' })
  update(
    @CurrentUser() editor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateMovieDto,
    @UploadedFile() poster?: StorageFile,
  ): Promise<MovieResponseDto> {
    return this.moviesService.update(id, dto, editor, poster);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(RoleName.Admin, RoleName.Provider)
  @ApiBearerAuth('access-token')
  @ApiForbiddenResponse({ description: 'Providers may only delete their own movies' })
  @ApiOperation({ summary: 'Soft-delete a movie (admin, or the provider who created it)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Movie deleted' })
  @ApiNotFoundResponse({ description: 'Movie does not exist' })
  remove(
    @CurrentUser() editor: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    return this.moviesService.remove(id, editor);
  }
}
