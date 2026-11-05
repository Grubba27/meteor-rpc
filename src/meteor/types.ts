// Structural types for the Meteor objects meteor-rpc exposes in its public API.
// They mirror the shapes in Meteor's own declarations, so a real Meteor object is
// assignable to them under every type provider, but they never import `meteor/*`.

/** Details of the DDP connection that made a call. Mirrors `Meteor.Connection`. */
export interface ConnectionInfo {
  readonly id: string;
  readonly clientAddress: string;
  readonly httpHeaders: Readonly<Record<string, string>>;
  close(): void;
  onClose(callback: () => void): void;
}

/** `this` inside a method resolver. At runtime it is Meteor's method invocation. */
export interface MethodInvocation {
  readonly userId: string | null;
  readonly isSimulation: boolean;
  readonly connection: ConnectionInfo | null;
  setUserId(userId: string | null): Promise<void>;
  unblock(): void;
}

/** `this` inside a publication resolver. At runtime it is Meteor's `Subscription`. */
export interface Subscription {
  readonly userId: string | null;
  readonly connection: ConnectionInfo;
  added(collection: string, id: string, fields: Record<string, unknown>): void;
  changed(collection: string, id: string, fields: Record<string, unknown>): void;
  removed(collection: string, id: string): void;
  ready(): void;
  stop(): void;
  error(error: Error): void;
  onStop(callback: () => void): void;
  unblock(): void;
}

/** Handle returned by a subscription. Mirrors `Meteor.SubscriptionHandle`. */
export interface SubscriptionHandle {
  stop(): void;
  ready(): boolean;
}

/** Callbacks accepted by `subscribe`. */
export interface SubscribeCallbacks {
  onReady?: () => void;
  onStop?: (error?: unknown) => void;
}

/** A `Meteor.Error` as received by the caller. */
export interface MeteorErrorLike extends Error {
  error: string | number;
  reason?: string | undefined;
  details?: unknown;
  errorType?: string | undefined;
}

/** Anything that looks like a Mongo cursor. Used to infer the published document type. */
export interface CursorLike<TDoc> {
  fetch(): TDoc[];
}

/** Mongo selector accepted by client collections. */
export type Selector = string | Readonly<Record<string, unknown>>;

/** Options accepted by `find` / `findOne` on client collections. */
export interface FindOptions {
  sort?: Readonly<Record<string, 1 | -1>>;
  skip?: number;
  limit?: number;
  fields?: Readonly<Record<string, 0 | 1>>;
  projection?: Readonly<Record<string, 0 | 1>>;
  reactive?: boolean;
}

/** A client-side cursor. At runtime it is a `Mongo.Cursor`. */
export interface ClientCursor<TDoc> extends CursorLike<TDoc> {
  fetchAsync(): Promise<TDoc[]>;
  count(): number;
  countAsync(): Promise<number>;
  forEach(callback: (doc: TDoc, index: number) => void): void;
  forEachAsync(callback: (doc: TDoc, index: number) => void): Promise<void>;
  map<TResult>(callback: (doc: TDoc, index: number) => TResult): TResult[];
  mapAsync<TResult>(callback: (doc: TDoc, index: number) => TResult): Promise<TResult[]>;
}

/**
 * A client-side collection holding the documents of one publication.
 * At runtime it is a `Mongo.Collection`; cast it if you need the full Meteor API.
 */
export interface ClientCollection<TDoc> {
  find(selector?: Selector, options?: FindOptions): ClientCursor<TDoc>;
  findOne(selector?: Selector, options?: FindOptions): TDoc | undefined;
  findOneAsync(selector?: Selector, options?: FindOptions): Promise<TDoc | undefined>;
}

/** A DDP connection: `Meteor.connection`, or the result of `DDP.connect(url)`. */
export interface ConnectionLike {
  /** Present on every Meteor 3 connection (optional only because `@types/meteor` omits it). */
  callAsync?(name: string, ...args: any[]): Promise<unknown>;
  subscribe(name: string, ...args: any[]): SubscriptionHandle;
}
