# RPC

## What is this package?

This package provides functions for building E2E type-safe RPCs.
they are:

- crateMethod
- createPublication

## How to use it?

### createMethod

```typescript
  const test1 = createMethod('name', z.any(), () => 'str');
  const result = await test1();
//    ˆ? is string and their value is 'str'
```

_example of use_

createMethod accepts 4 arguments:

- name: string
- schema: ZodSchema (validator)
- handler (optional): function that receives the arguments of the method and returns the result
- config (optional): object with the following properties:

```typescript
type Config<S, T> = {
  rateLimit?: {
    interval: number,
    limit: number
  },
  methodHooks?: {
    onBeforeResolve?: Array<(raw: unknown, parsed: S,) => void>;
    onAfterResolve?: Array<(raw: Maybe<T>, parsed: S, result: T) => void>;
    onErrorResolve?: Array<(err: Meteor.Error | Error | unknown, raw: Maybe<T>, parsed: S) => void>;
  }
}
```

### createPublication

```typescript
  const publication = createPublication('findRooms', z.object({level: z.number()}), ({level}) => Rooms.find({level: level}));
  const result = publication({level: 1}, (rooms) => console.log(rooms));
//                                            ˆ? subscription 

```
_example of use_

createPublication accepts 4 arguments:

- name: string
- schema: ZodSchema (validator)
- handler (optional): function that is being published
- config (optional): object with the following properties:

_note that subscription returns the subscription handler the same way as Meteor.publish_

```typescript
type Config<S, T> = {
  rateLimit?: {
    interval: number,
    limit: number
  },
  methodHooks?: {
    onBeforeResolve?: Array<(raw: unknown, parsed: S,) => void>;
    onAfterResolve?: Array<(raw: Maybe<T>, parsed: S, result: T) => void>;
    onErrorResolve?: Array<(err: Meteor.Error | Error | unknown, raw: Maybe<T>, parsed: S) => void>;
  }
}
```
