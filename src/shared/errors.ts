export class GameError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export class NotFoundError extends GameError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class AuthError extends GameError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends GameError {
  constructor(message: string = 'Forbidden') {
    super(message, 'FORBIDDEN', 403);
    this.name = 'ForbiddenError';
  }
}

export class InsufficientResourcesError extends GameError {
  constructor(resource: string, required: number, available: number) {
    super(
      `Insufficient ${resource}: need ${required}, have ${available}`,
      'INSUFFICIENT_RESOURCES',
    );
    this.name = 'InsufficientResourcesError';
  }
}

export class InvalidActionError extends GameError {
  constructor(message: string) {
    super(message, 'INVALID_ACTION');
    this.name = 'InvalidActionError';
  }
}
