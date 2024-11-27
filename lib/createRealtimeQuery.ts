import { z } from "zod";
// @ts-ignore
import { Meteor, Subscription as MeteorSubscription } from "meteor/meteor";
import { Config } from "../types";
import { useFind } from "./utils/hooks/useFind";
import { useSubscribe } from "./utils/hooks/useSubscribe";
// @ts-ignore
import { Mongo } from "meteor/mongo";

export const createRealtimeQuery = <
  Name extends string,
  Schema extends z.ZodUndefined | z.ZodTypeAny,
  // @ts-ignore
  Result,
  UnwrappedArgs extends unknown[] = Schema extends z.ZodUndefined
    ? []
    : [z.input<Schema>]
>(
  name: Name,
  schema: Schema,
  resolver: (
    this: MeteorSubscription,
    args: z.input<Schema>
  ) => Mongo.Cursor<Result> | Promise<Mongo.Cursor<Result>>,
  config?: Config<UnwrappedArgs, Result>
) => {
  if (Meteor.isServer) {
    Meteor.publish(name, async function (args: unknown[]) {
      const parsed: z.output<Schema> = schema.parse(args);

      const clientCollection = name;

      const cursor: Mongo.Cursor<Result> =
      // @ts-ignore
          await resolver.call(this, parsed);

      const observerHandle = await cursor.observeChanges({
        added: (_id: string, fields: Partial<Result>) => {
          // @ts-ignore
          this.added(clientCollection, _id, fields);
        },
        changed: (_id: string, fields: Partial<Result>) => {
          // @ts-ignore
          this.changed(clientCollection, _id, fields);
        },
        removed: (_id: string) => {
          // @ts-ignore
          this.removed(clientCollection, _id);
        },
      });
      // @ts-ignore
      this.ready();
      // @ts-ignore
      this.onStop(() => {
        observerHandle.stop();
      });
    });
  }
  function query(args: z.input<Schema>) {
    // @ts-ignore
    return new Mongo.Collection<Result>(name).find(
      args
    ) as unknown as Mongo.Cursor<Result>;
  }
  query.config = { ...config, name, schema, resolver };
  query.useRealtime = (args: z.input<Schema>) => {
    useSubscribe(name);
    const data = useFind(() => {
      return query(args);
    }, [args]);
    return data;
  };
  return query;
};
