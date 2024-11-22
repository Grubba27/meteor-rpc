import { z } from "zod";
import { Meteor, Subscription as MeteorSubscription } from "meteor/meteor";
import { Config } from "../types";
import { useFind } from "./utils/hooks/useFind";
import { useSubscribe } from "./utils/hooks/useSubscribe";


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
  resolver: (this: MeteorSubscription, args: z.input<Schema>) => Result,
  config?: Config<UnwrappedArgs, Result>
) => {
  if (Meteor.isServer) {
    Meteor.publish(name, function (...args: unknown[]) {
      const parsed: z.output<Schema> = schema.parse(args);
      return resolver.call(this, parsed);
    });
  }
  function query(args: z.input<Schema>) {
    return resolver.call(this, args);
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
