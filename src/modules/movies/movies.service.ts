import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, type WhereOptions } from 'sequelize';

import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import type { AuthenticatedUser } from '../auth/auth.constants';
import { RoleName } from '../roles/entities/role.entity';
import { StorageService, type UploadedFile } from '../storage/storage.service';
import { CreateMovieDto } from './dto/create-movie.dto';
import { MovieResponseDto } from './dto/movie-response.dto';
import { MovieSortBy, QueryMoviesDto } from './dto/query-movies.dto';
import { UpdateMovieDto } from './dto/update-movie.dto';
import { Movie, type MovieAttributes } from './entities/movie.entity';

/** Bucket sub-folder for movie artwork, under the environment prefix. */
const POSTER_FOLDER = 'movies';

/** Maps API sort keys to physical columns so clients can't order by anything. */
const SORT_COLUMN: Record<MovieSortBy, keyof MovieAttributes> = {
  [MovieSortBy.Title]: 'title',
  [MovieSortBy.ReleaseYear]: 'releaseYear',
  [MovieSortBy.Rating]: 'rating',
  [MovieSortBy.CreatedAt]: 'createdAt',
};

@Injectable()
export class MoviesService {
  private readonly logger = new Logger(MoviesService.name);

  constructor(
    @InjectModel(Movie)
    private readonly movieModel: typeof Movie,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Creates a movie, optionally uploading its poster.
   *
   * The upload happens first because it is the step most likely to fail. If
   * the insert then fails, the just-stored object is deleted again — otherwise
   * every failed create would leak an unreferenced file into the bucket.
   */
  async create(
    dto: CreateMovieDto,
    author: AuthenticatedUser,
    poster?: UploadedFile,
  ): Promise<MovieResponseDto> {
    const stored = poster
      ? await this.storageService.uploadImage(poster, POSTER_FOLDER)
      : undefined;

    try {
      const movie = await this.movieModel.create({
        title: dto.title,
        synopsis: dto.synopsis ?? null,
        genre: dto.genre,
        releaseYear: dto.releaseYear,
        durationMinutes: dto.durationMinutes,
        rating: dto.rating ?? 0,
        // An uploaded file wins over a posterUrl in the body: sending both is
        // ambiguous, and the upload is the more deliberate act.
        posterUrl: stored?.url ?? dto.posterUrl ?? null,
        isPublished: dto.isPublished ?? false,
        // Recorded from the token, never the payload: this is what decides who
        // may edit the row later.
        createdById: author.id,
      });

      this.logger.log(`Created movie ${movie.id}${stored ? ` with poster ${stored.path}` : ''}`);

      return MovieResponseDto.fromEntity(movie);
    } catch (error) {
      if (stored) await this.storageService.removeQuietly(stored.path);
      throw error;
    }
  }

  async findAll(
    query: QueryMoviesDto,
    viewer: AuthenticatedUser,
  ): Promise<PaginatedResponseDto<MovieResponseDto>> {
    const { rows, count } = await this.movieModel.findAndCountAll({
      where: this.buildWhere(query, viewer),
      order: [[SORT_COLUMN[query.sortBy], query.sortDirection]],
      limit: query.limit,
      offset: query.offset,
    });

    return PaginatedResponseDto.from(
      MovieResponseDto.fromEntities(rows),
      count,
      query.page,
      query.pageSize,
    );
  }

  async findOne(id: string, viewer: AuthenticatedUser): Promise<MovieResponseDto> {
    const movie = await this.findEntityOrFail(id);

    // A draft is invisible to anyone who cannot manage it. 404 rather than 403
    // so the existence of an unpublished title is not disclosed.
    if (!movie.isPublished && !this.canManage(movie, viewer)) {
      throw new NotFoundException(`Movie with id "${id}" was not found`);
    }

    return MovieResponseDto.fromEntity(movie);
  }

  /**
   * Partial update, optionally replacing the artwork.
   *
   * The new file is uploaded first, and the **old object is deleted only after
   * the row commits** — the other order would leave a movie pointing at a file
   * that no longer exists if the write failed. If the write does fail, the
   * freshly uploaded object is removed instead, so neither path leaks a file.
   */
  async update(
    id: string,
    dto: UpdateMovieDto,
    editor: AuthenticatedUser,
    poster?: UploadedFile,
  ): Promise<MovieResponseDto> {
    const movie = await this.assertCanManage(id, editor);
    const previousPosterUrl = movie.posterUrl;

    const stored = poster
      ? await this.storageService.uploadImage(poster, POSTER_FOLDER)
      : undefined;

    let updated: Movie;

    try {
      updated = await movie.update({
        ...this.toPatch(dto),
        ...(stored ? { posterUrl: stored.url } : {}),
      });
    } catch (error) {
      if (stored) await this.storageService.removeQuietly(stored.path);
      throw error;
    }

    if (stored) {
      // Only ours, and only if it is actually a different object.
      const previousPath = this.storageService.publicPathOf(previousPosterUrl);
      if (previousPath && previousPath !== stored.path) {
        await this.storageService.removeQuietly(previousPath);
      }
    }

    this.logger.log(
      `Updated movie ${id} by ${editor.email}${stored ? ` (new poster ${stored.path})` : ''}`,
    );

    return MovieResponseDto.fromEntity(updated);
  }

  async remove(id: string, editor: AuthenticatedUser): Promise<void> {
    const movie = await this.assertCanManage(id, editor);
    await movie.destroy();

    this.logger.log(`Soft-deleted movie ${id} by ${editor.email}`);
  }

  /**
   * An ADMIN manages the whole catalog; a PROVIDER manages exactly what they
   * created. Seeded rows have no author, so only an ADMIN can touch them.
   */
  private canManage(movie: Movie, user: AuthenticatedUser): boolean {
    if (user.role === RoleName.Admin) return true;
    if (user.role !== RoleName.Provider) return false;

    return movie.createdById !== null && movie.createdById === user.id;
  }

  private async assertCanManage(id: string, user: AuthenticatedUser): Promise<Movie> {
    const movie = await this.findEntityOrFail(id);

    if (!this.canManage(movie, user)) {
      throw new ForbiddenException('You can only manage movies you created');
    }

    return movie;
  }

  /**
   * Single place that throws 404, so every caller reports a missing movie the
   * same way instead of each endpoint inventing its own message.
   */
  private async findEntityOrFail(id: string): Promise<Movie> {
    const movie = await this.movieModel.findByPk(id);

    if (!movie) {
      throw new NotFoundException(`Movie with id "${id}" was not found`);
    }

    return movie;
  }

  /**
   * Combines the caller's *visibility* with their requested filters.
   *
   * Every condition is pushed into a single `Op.and`, never merged with
   * `Object.assign`. Merging shares one key per column, so a query filter on
   * `isPublished` would silently **overwrite** the visibility rule and hand a
   * plain user the drafts — which is exactly what it did before this was
   * rewritten. Under `Op.and` the two conditions intersect, so asking for
   * drafts you cannot see returns nothing.
   */
  private buildWhere(
    query: QueryMoviesDto,
    viewer: AuthenticatedUser,
  ): WhereOptions<MovieAttributes> {
    const conditions: WhereOptions<MovieAttributes>[] = [];

    /* ---- visibility: decided here, never from a query parameter ---- */
    if (viewer.role === RoleName.Provider) {
      // Everything published, plus their own drafts.
      conditions.push({ [Op.or]: [{ isPublished: true }, { createdById: viewer.id }] });
    } else if (viewer.role !== RoleName.Admin) {
      conditions.push({ isPublished: true });
    }

    /* ---- caller filters ---- */
    if (query.mine) {
      conditions.push({ createdById: viewer.id });
    }
    if (query.search) {
      conditions.push({ title: { [Op.iLike]: `%${query.search}%` } });
    }
    if (query.genre) {
      conditions.push({ genre: query.genre });
    }
    if (query.releaseYear !== undefined) {
      conditions.push({ releaseYear: query.releaseYear });
    }
    if (query.isPublished !== undefined) {
      conditions.push({ isPublished: query.isPublished });
    }

    return conditions.length > 0 ? { [Op.and]: conditions } : {};
  }

  /** Drops `undefined` keys so a partial PATCH never nulls untouched columns. */
  private toPatch(dto: UpdateMovieDto): Partial<MovieAttributes> {
    const patch: Partial<MovieAttributes> = {};

    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.synopsis !== undefined) patch.synopsis = dto.synopsis;
    if (dto.genre !== undefined) patch.genre = dto.genre;
    if (dto.releaseYear !== undefined) patch.releaseYear = dto.releaseYear;
    if (dto.durationMinutes !== undefined) patch.durationMinutes = dto.durationMinutes;
    if (dto.rating !== undefined) patch.rating = dto.rating;
    if (dto.posterUrl !== undefined) patch.posterUrl = dto.posterUrl;
    if (dto.isPublished !== undefined) patch.isPublished = dto.isPublished;

    return patch;
  }
}
