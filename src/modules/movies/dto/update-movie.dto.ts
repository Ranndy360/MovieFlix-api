import { PartialType } from '@nestjs/swagger';

import { CreateMovieDto } from './create-movie.dto';

/**
 * `PartialType` from `@nestjs/swagger` (not `@nestjs/mapped-types`) so the
 * OpenAPI schema inherits the field metadata as well as the validators.
 */
export class UpdateMovieDto extends PartialType(CreateMovieDto) {}
