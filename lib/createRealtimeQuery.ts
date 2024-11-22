import { z } from "zod";
import { Meteor, Subscription as MeteorSubscription } from "meteor/meteor";
import { Config } from "../types";
import { useFind } from "./utils/hooks/useFind";
import { useSubscribe } from "./utils/hooks/useSubscribe";
import { Mongo } from "meteor/mongo";

export const createRealtimeQuery = <
  Name extends string,
  Schema extends z.ZodUndefined | z.ZodTypeAny,
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

      const cursor = await resolver.call(this, parsed);

      const observerHandle = await cursor.observeChanges({
        added: (_id, fields) => {
          // console.log('Added:', _id, fields);
          this.added(clientCollection, _id, fields);
        },
        changed: (_id, fields) => {
          // console.log('Changed:', _id, fields);
          this.changed(clientCollection, _id, fields);
        },
        removed: (_id) => {
          // console.log('Removed:', _id);
          this.removed(clientCollection, _id);
        },
      });

      this.ready();

      this.onStop(() => {
        observerHandle.stop();
      });
    });
  }
  function query(args: z.input<Schema>) {
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
